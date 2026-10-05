// Votos de um candidato por seção eleitoral de uma zona do DF em 2026, com o local de votação,
// comparados com 2022 por local de votação.
// Uso: node tse-secoes.js <numero2026> --zona 4 [--numero2022 44044] [--csv prefixo]
//   O cargo vem do tamanho do número: 4 dígitos = Deputado Federal, 5 dígitos = Deputado Distrital.
//
// Fontes:
//   2026 - boletins de urna (bu.dat) de cada seção no site de resultados do TSE.
//   2026 - nome do local por seção: dados/locais-secao-2026-df.csv, extraído de
//          perfil_eleitor_secao_2026_DF (Portal de Dados Abertos do TSE).
//   2022 - dados/votos-secao-2022-df.csv e dados/secoes-2022-df.csv, extraídos de
//          votacao_secao_2022_DF e detalhe_votacao_secao_2022 (Portal de Dados Abertos do TSE).

const fs = require("fs");
const path = require("path");

const PLEITO = 3220;
const ELEICAO = 6259;
const baseUrna = `https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/${PLEITO}`;

const cargos = {
  4: { codigo: 6, nome: "Deputado Federal" },
  5: { codigo: 8, nome: "Deputado Distrital" },
};

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function lerCsvLocal(nome) {
  const texto = fs.readFileSync(path.join(__dirname, "dados", nome), "utf8").trim();
  const [cabecalho, ...linhas] = texto.split(/\r?\n/);
  const colunas = cabecalho.split(";");
  return linhas.map(l => {
    const valores = l.split(";");
    return Object.fromEntries(colunas.map((c, i) => [c, valores[i]]));
  });
}

// ---------- Leitura do boletim de urna (ASN.1 DER) ----------

function lerDer(buf, inicio = 0, fim = buf.length) {
  const nos = [];
  let i = inicio;
  while (i < fim) {
    const tag = buf[i++];
    const classe = tag >> 6;
    const construido = (tag >> 5) & 1;
    let numero = tag & 0x1f;
    if (numero === 0x1f) {
      numero = 0;
      let b;
      do { b = buf[i++]; numero = (numero << 7) | (b & 0x7f); } while (b & 0x80);
    }
    let tamanho = buf[i++];
    if (tamanho & 0x80) {
      const n = tamanho & 0x7f;
      tamanho = 0;
      for (let k = 0; k < n; k++) tamanho = tamanho * 256 + buf[i++];
    }
    const no = { classe, numero, construido };
    if (construido) no.filhos = lerDer(buf, i, i + tamanho);
    else no.valor = buf.subarray(i, i + tamanho);
    nos.push(no);
    i += tamanho;
  }
  return nos;
}

function inteiro(no) {
  let v = 0;
  for (const b of no.valor) v = v * 256 + b;
  return v;
}

const ehInteiro = no => no && !no.construido && no.classe === 0 && no.numero === 2;

function* percorrer(nos) {
  for (const no of nos) {
    yield no;
    if (no.filhos) yield* percorrer(no.filhos);
  }
}

// Retorna local, eleitores aptos, comparecimento e votos do candidato na seção.
function lerBoletim(buf, codigoCargo, numero) {
  const envelope = lerDer(buf)[0].filhos;

  // identificação da seção no envelope: { {município, zona}, local, seção }
  const id = envelope.find(n => n.construido && n.classe === 2 && n.numero === 0).filhos;
  const local = inteiro(id[1]);

  const conteudo = envelope.filter(n => !n.construido && n.numero === 4 && n.classe === 0).pop();
  const boletim = lerDer(conteudo.valor);

  // bloco da eleição estadual: { idEleição, aptos, ..., resultados }
  let blocoEleicao = null;
  for (const no of percorrer(boletim)) {
    if (no.construido && no.classe === 0 && no.numero === 16 &&
        ehInteiro(no.filhos[0]) && inteiro(no.filhos[0]) === ELEICAO) {
      blocoEleicao = no;
      break;
    }
  }
  if (!blocoEleicao) return { local, aptos: 0, comparecimento: 0, votos: 0 };

  const aptos = inteiro(blocoEleicao.filhos[1]);
  let comparecimento = 0;
  let votos = 0;

  for (const no of percorrer(blocoEleicao.filhos)) {
    // resultado do cargo: { tipoCargo (enum), comparecimento, ... }
    if (no.construido && no.filhos[0] && no.filhos[0].numero === 10 && ehInteiro(no.filhos[1])) {
      // guarda o comparecimento do bloco que contém o cargo pedido
      const temCargo = [...percorrer(no.filhos)].some(n =>
        n.construido && n.filhos[0] && n.filhos[0].classe === 2 && n.filhos[0].numero === 1 &&
        !n.filhos[0].construido && inteiro(n.filhos[0]) === codigoCargo &&
        n.filhos.some(f => f.construido && f.numero === 16));
      if (temCargo) comparecimento = inteiro(no.filhos[1]);
    }

    // totais do cargo: { [1] códigoCargo, ordem, { votáveis } }
    if (!(no.construido && no.filhos[0] && no.filhos[0].classe === 2 && no.filhos[0].numero === 1 &&
          !no.filhos[0].construido && inteiro(no.filhos[0]) === codigoCargo)) continue;
    const lista = no.filhos.find(f => f.construido && f.numero === 16);
    if (!lista) continue;

    // votável: { [1] tipoVoto, [2] quantidade, [3] { partido, código }, ... }
    for (const votavel of lista.filhos) {
      const tipo = votavel.filhos.find(f => f.classe === 2 && f.numero === 1);
      const qtd = votavel.filhos.find(f => f.classe === 2 && f.numero === 2);
      const ident = votavel.filhos.find(f => f.classe === 2 && f.numero === 3);
      if (!tipo || !qtd || !ident || inteiro(tipo) !== 1) continue;
      if (String(inteiro(ident.filhos[1])) === numero) votos += inteiro(qtd);
    }
  }

  return { local, aptos, comparecimento, votos };
}

// ---------- Busca no site do TSE ----------

async function buscar(url, tipo) {
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    try {
      const resposta = await fetch(url, { cache: "no-store" });
      if (resposta.status === 404) return null;
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      return tipo === "json" ? await resposta.json() : Buffer.from(await resposta.arrayBuffer());
    } catch (erro) {
      if (tentativa === 4) throw erro;
      await new Promise(r => setTimeout(r, 1000 * 2 ** tentativa));
    }
  }
}

async function secaoDoBoletim(zona, secao, codigoCargo, numero) {
  const z = String(zona).padStart(4, "0");
  const s = String(secao).padStart(4, "0");
  const pasta = `${baseUrna}/dados/df/97012/${z}/${s}`;
  const aux = await buscar(`${pasta}/p00${PLEITO}-df-m97012-z${z}-s${s}-aux.json`, "json");
  const hash = (aux?.hashes || []).filter(h => /totalizad/i.test(h.st)).pop() || aux?.hashes?.at(-1);
  const arquivo = hash?.arq?.find(a => a.tp === "bu");
  if (!arquivo) return null;
  const bu = await buscar(`${pasta}/${hash.hash}/${arquivo.nm}`, "bin");
  return bu ? lerBoletim(bu, codigoCargo, numero) : null;
}

async function emParalelo(itens, limite, fn) {
  const saida = new Array(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: limite }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await fn(itens[i], i);
    }
  }));
  return saida;
}

// ---------- 2022 ----------

function dados2022(zona, codigoCargo, numero) {
  const secoes = lerCsvLocal("secoes-2022-df.csv")
    .filter(r => Number(r.zona) === zona && Number(r.cargo) === codigoCargo);
  const votos = {};
  if (numero) {
    for (const r of lerCsvLocal("votos-secao-2022-df.csv")) {
      if (Number(r.zona) === zona && Number(r.cargo) === codigoCargo && r.numero === numero) {
        votos[Number(r.secao)] = (votos[Number(r.secao)] || 0) + Number(r.votos);
      }
    }
  }
  return secoes.map(r => ({
    secao: Number(r.secao),
    local: Number(r.local),
    nome_local: r.nome_local,
    aptos: Number(r.aptos),
    votos: votos[Number(r.secao)] || 0,
  }));
}

// ---------- Saída ----------

const pct = (v, total, casas = 2) => (total ? Number((v / total * 100).toFixed(casas)) : 0);
const decimal = (v, casas = 2) => (v == null ? "" : Number(v).toFixed(casas).replace(".", ","));
const campo = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

function salvarCsv(arquivo, cabecalho, linhas) {
  fs.writeFileSync(arquivo, "﻿" + [cabecalho.join(";"), ...linhas.map(l => l.join(";"))].join("\r\n") + "\r\n");
  console.log("CSV salvo em", arquivo);
}

const normalizar = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function porLocal(secoes) {
  const mapa = new Map();
  for (const s of secoes) {
    const chave = normalizar(s.nome_local) || `LOCAL ${s.local}`;
    const atual = mapa.get(chave) || { local: s.local, nome_local: s.nome_local, secoes: 0, aptos: 0, votos: 0 };
    atual.secoes++;
    atual.aptos += s.aptos;
    atual.votos += s.votos;
    mapa.set(chave, atual);
  }
  return mapa;
}

(async () => {
  const numero = process.argv.slice(2).find((a, i, args) => /^\d+$/.test(a) && !args[i - 1]?.startsWith("--"));
  const zona = Number(argumento("--zona", "4"));
  const numero2022 = argumento("--numero2022", null);
  const prefixo = argumento("--csv", null);

  const cargo = numero ? cargos[numero.length] : null;
  if (!cargo || !zona) {
    console.error("Uso: node tse-secoes.js <numero2026> --zona 4 [--numero2022 44044] [--csv prefixo]");
    process.exit(1);
  }
  if (numero2022 && cargos[numero2022.length]?.codigo !== cargo.codigo) {
    console.error("O número de 2022 precisa ser do mesmo cargo (mesma quantidade de dígitos).");
    process.exit(1);
  }

  console.log(`Candidato ${numero} — ${cargo.nome} — Zona ${zona}`);

  // seções da zona em 2026
  const config = await buscar(`${baseUrna}/config/df/df-p00${PLEITO}-cs.json`, "json");
  const zonaCfg = config.abr[0].mu.find(m => m.cd === "97012").zon.find(z => Number(z.cd) === zona);
  if (!zonaCfg) {
    console.error(`Zona ${zona} não encontrada.`);
    process.exit(1);
  }
  const listaSecoes = zonaCfg.sec.map(s => Number(s.ns)).sort((a, b) => a - b);

  const nomes = new Map(
    lerCsvLocal("locais-secao-2026-df.csv")
      .filter(r => Number(r.zona) === zona)
      .map(r => [Number(r.secao), r])
  );

  let feitas = 0;
  const lidas = await emParalelo(listaSecoes, 6, async secao => {
    const r = await secaoDoBoletim(zona, secao, cargo.codigo, numero).catch(e => {
      console.warn(`Seção ${secao}: erro ao ler o boletim (${e.message})`);
      return null;
    });
    if (++feitas % 50 === 0) console.log(`  ${feitas}/${listaSecoes.length} seções lidas`);
    return r && { secao, ...r };
  });

  // seções especiais (ex.: unidades de internação) podem não constar no perfil do eleitorado;
  // nesse caso usa o nome do mesmo nº de local em 2022
  const nomesLocal2022 = new Map(
    lerCsvLocal("secoes-2022-df.csv")
      .filter(r => Number(r.zona) === zona)
      .map(r => [Number(r.local), r.nome_local])
  );

  const secoes2026 = lidas.filter(Boolean).map(s => ({
    secao: s.secao,
    local: s.local,
    nome_local: nomes.get(s.secao)?.nome_local || nomesLocal2022.get(s.local) || `LOCAL ${s.local}`,
    aptos: s.aptos,
    comparecimento: s.comparecimento,
    votos: s.votos,
    percentual_aptos: pct(s.votos, s.aptos),
  }));
  const faltando = listaSecoes.length - secoes2026.length;
  if (faltando) console.warn(`Atenção: ${faltando} seção(ões) sem boletim disponível.`);

  // conferência com o total da zona publicado pelo TSE
  const z = String(zona).padStart(4, "0");
  const c = String(cargo.codigo).padStart(4, "0");
  const totalZona = await buscar(
    `https://resultados.tse.jus.br/oficial/ele2026/${ELEICAO}/dados/df/df97012-z${z}-c${c}-e00${ELEICAO}-u.json`, "json");
  let candidatoZona = null;
  for (const cg of totalZona?.carg || []) for (const a of cg.agr || []) for (const p of a.par || [])
    for (const cd of p.cand || []) if (cd.n === numero) candidatoZona = { ...cd, sg: p.sg };

  const total2026 = secoes2026.reduce((s, x) => s + x.votos, 0);

  console.log("\nVOTOS POR SEÇÃO — 2026");
  console.table(secoes2026);
  if (candidatoZona) {
    console.log(`Candidato: ${candidatoZona.nmu}/${candidatoZona.sg} — ${candidatoZona.st}`);
    console.log(`Total nas seções: ${total2026} | Total da zona no TSE: ${candidatoZona.vap}` +
      (Number(candidatoZona.vap) === total2026 ? " (confere)" : " (DIFERENTE — verificar)"));
  }

  // comparação por local de votação
  const locais2026 = porLocal(secoes2026);
  const secoes2022 = numero2022 ? dados2022(zona, cargo.codigo, numero2022) : [];
  const locais2022 = porLocal(secoes2022);
  const total2022 = secoes2022.reduce((s, x) => s + x.votos, 0);

  const chaves = new Set([...locais2026.keys(), ...locais2022.keys()]);
  const comparacao = [...chaves].map(k => {
    const a = locais2026.get(k);
    const b = locais2022.get(k);
    return {
      local: a?.nome_local || b?.nome_local,
      secoes_2026: a?.secoes ?? 0,
      aptos_2026: a?.aptos ?? 0,
      votos_2026: a?.votos ?? 0,
      pct_2026: a ? pct(a.votos, a.aptos) : null,
      ...(numero2022 ? {
        secoes_2022: b?.secoes ?? 0,
        aptos_2022: b?.aptos ?? 0,
        votos_2022: b?.votos ?? 0,
        pct_2022: b ? pct(b.votos, b.aptos) : null,
        variacao_votos: (a?.votos ?? 0) - (b?.votos ?? 0),
      } : {}),
    };
  }).sort((x, y) => y.votos_2026 - x.votos_2026 || (y.votos_2022 ?? 0) - (x.votos_2022 ?? 0));

  console.log("\nVOTOS POR LOCAL DE VOTAÇÃO" + (numero2022 ? ` — 2026 (${numero}) x 2022 (${numero2022})` : ""));
  console.table(comparacao);
  console.log(`TOTAL 2026: ${total2026}` + (numero2022 ? ` | TOTAL 2022: ${total2022} | variação: ${total2026 - total2022}` : ""));

  if (prefixo) {
    salvarCsv(`${prefixo}-secoes-2026.csv`,
      ["Zona", "Seção", "Nº local", "Local de votação", "Eleitores aptos", "Comparecimento", "Votos", "% dos aptos"],
      [...secoes2026.map(s => [zona, s.secao, s.local, campo(s.nome_local), s.aptos, s.comparecimento, s.votos, decimal(s.percentual_aptos)]),
       ["TOTAL", "", "", "", secoes2026.reduce((t, s) => t + s.aptos, 0), secoes2026.reduce((t, s) => t + s.comparecimento, 0), total2026, ""]]);

    if (numero2022) {
      salvarCsv(`${prefixo}-secoes-2022.csv`,
        ["Zona", "Seção", "Nº local", "Local de votação", "Eleitores aptos", "Votos", "% dos aptos"],
        [...secoes2022.map(s => [zona, s.secao, s.local, campo(s.nome_local), s.aptos, s.votos, decimal(pct(s.votos, s.aptos))]),
         ["TOTAL", "", "", "", secoes2022.reduce((t, s) => t + s.aptos, 0), total2022, ""]]);
    }

    salvarCsv(`${prefixo}-locais.csv`,
      ["Local de votação", "Seções 2026", "Aptos 2026", "Votos 2026", "% aptos 2026",
       ...(numero2022 ? ["Seções 2022", "Aptos 2022", "Votos 2022", "% aptos 2022", "Variação de votos"] : [])],
      [...comparacao.map(l => [campo(l.local), l.secoes_2026, l.aptos_2026, l.votos_2026, decimal(l.pct_2026),
        ...(numero2022 ? [l.secoes_2022, l.aptos_2022, l.votos_2022, decimal(l.pct_2022), l.variacao_votos] : [])]),
       ["TOTAL", "", "", total2026, "", ...(numero2022 ? ["", "", total2022, "", total2026 - total2022] : [])]]);
  }
})();
