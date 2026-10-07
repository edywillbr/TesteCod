// Votos de candidatos por bairro e por zona administrativa de Manaus, a partir dos boletins de urna
// de cada seção (1º turno 2026).
// Uso: node tse-bairros.js <numero1> [<numero2> ...] [--cargo 3] [--csv prefixo]
//   --cargo: 3 = Governador (padrão), 5 = Senador, 6 = Deputado Federal, 7 = Deputado Estadual.
//   Percentuais sobre os votos válidos do cargo (nominais + legenda).
//
// Fontes:
//   - boletins de urna (bu.dat) de cada seção, no site de resultados do TSE;
//   - dados/locais-secao-2026-am-manaus.csv: seção → local de votação → bairro, extraído de
//     eleitorado_local_votacao_2026 (Portal de Dados Abertos do TSE);
//   - dados/zonas-administrativas-manaus.csv: bairro → zona administrativa (Lei Municipal 1.401/2010).

const fs = require("fs");
const path = require("path");

const PLEITO = 3220;
const ELEICAO = 6259;
const UF = "am";
const MUNICIPIO = "02550"; // Manaus
const baseUrna = `https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/${PLEITO}`;
const baseResultados = `https://resultados.tse.jus.br/oficial/ele2026/${ELEICAO}`;

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

function* percorrer(nos) {
  for (const no of nos) {
    yield no;
    if (no.filhos) yield* percorrer(no.filhos);
  }
}

const ehInteiro = no => no && !no.construido && no.classe === 0 && no.numero === 2;
const filho = (no, numero) => no.filhos.find(f => f.classe === 2 && f.numero === numero);

// Tipos de voto no boletim: 1 = nominal, 2 = branco, 3 = nulo, 4 = legenda.
function lerBoletim(buf, codigoCargo) {
  const envelope = lerDer(buf)[0].filhos;
  const id = envelope.find(n => n.construido && n.classe === 2 && n.numero === 0).filhos;
  const local = inteiro(id[1]);
  const conteudo = envelope.filter(n => !n.construido && n.numero === 4 && n.classe === 0).pop();
  const boletim = lerDer(conteudo.valor);

  let bloco = null;
  for (const no of percorrer(boletim)) {
    if (no.construido && no.classe === 0 && no.numero === 16 &&
        ehInteiro(no.filhos[0]) && inteiro(no.filhos[0]) === ELEICAO) {
      bloco = no;
      break;
    }
  }
  const r = { local, aptos: 0, votos: {}, brancos: 0, nulos: 0, legenda: 0 };
  if (!bloco) return r;
  r.aptos = inteiro(bloco.filhos[1]);

  for (const no of percorrer(bloco.filhos)) {
    const cab = no.construido && no.filhos[0];
    if (!(cab && cab.classe === 2 && cab.numero === 1 && !cab.construido && inteiro(cab) === codigoCargo)) continue;
    const lista = no.filhos.find(f => f.construido && f.numero === 16);
    if (!lista) continue;
    for (const votavel of lista.filhos) {
      const tipo = filho(votavel, 1);
      const qtd = filho(votavel, 2);
      if (!tipo || !qtd) continue;
      const t = inteiro(tipo), q = inteiro(qtd);
      if (t === 1) {
        const n = String(inteiro(filho(votavel, 3).filhos[1]));
        r.votos[n] = (r.votos[n] || 0) + q;
      } else if (t === 2) r.brancos += q;
      else if (t === 3) r.nulos += q;
      else if (t === 4) r.legenda += q;
    }
  }
  return r;
}

// ---------- Busca no site do TSE ----------

async function buscar(url, tipo) {
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    try {
      const resposta = await fetch(url, { cache: "no-store" });
      if (resposta.status === 404) return null;
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      return tipo === "json" ? await resposta.json() : Buffer.from(await resposta.arrayBuffer());
    } catch (erro) {
      if (tentativa === 5) throw erro;
      await new Promise(r => setTimeout(r, 1000 * 2 ** tentativa));
    }
  }
}

async function lerSecao(zona, secao, codigoCargo) {
  const z = String(zona).padStart(4, "0");
  const s = String(secao).padStart(4, "0");
  const pasta = `${baseUrna}/dados/${UF}/${MUNICIPIO}/${z}/${s}`;
  const aux = await buscar(`${pasta}/p00${PLEITO}-${UF}-m${MUNICIPIO}-z${z}-s${s}-aux.json`, "json");
  const hash = (aux?.hashes || []).filter(h => /totalizad/i.test(h.st)).pop();
  const arquivo = hash?.arq?.find(a => a.tp === "bu");
  if (!arquivo) return null; // seção agregada ou sem boletim
  const bu = await buscar(`${pasta}/${hash.hash}/${arquivo.nm}`, "bin");
  return bu ? lerBoletim(bu, codigoCargo) : null;
}

async function emParalelo(itens, limite, fn) {
  const saida = new Array(itens.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: limite }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await fn(itens[i]);
    }
  }));
  return saida;
}

// ---------- Saída ----------

const pct = (v, total) => (total ? Number((v / total * 100).toFixed(2)) : 0);
const decimal = (v, casas = 2) => (v == null ? "" : Number(v).toFixed(casas).replace(".", ","));
const campo = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
const minusculas = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);
const nomeProprio = t => String(t || "").toLowerCase().split(" ")
  .map((p, i) => (/^(i|ii|iii|iv|v|vi)$/.test(p) ? p.toUpperCase()
    : i > 0 && minusculas.has(p.toUpperCase()) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
  .join(" ");

function salvarCsv(arquivo, cabecalho, linhas) {
  fs.writeFileSync(arquivo, "﻿" + [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n");
  console.log("CSV salvo em", arquivo);
}

function agrupar(secoes, chave, numeros) {
  const mapa = new Map();
  for (const s of secoes) {
    const k = chave(s);
    const g = mapa.get(k) || { secoes: 0, locais: new Set(), aptos: 0, validos: 0, votos: {} };
    g.secoes++;
    g.locais.add(s.local);
    g.aptos += s.aptos;
    g.validos += s.validos;
    for (const n of numeros) g.votos[n] = (g.votos[n] || 0) + (s.votos[n] || 0);
    mapa.set(k, g);
  }
  return mapa;
}

(async () => {
  const numeros = process.argv.slice(2).filter((a, i, args) => /^\d+$/.test(a) && !String(args[i - 1]).startsWith("--"));
  const codigoCargo = Number(argumento("--cargo", "3"));
  const prefixo = argumento("--csv", null);
  if (!numeros.length) {
    console.error("Uso: node tse-bairros.js <numero1> [<numero2> ...] [--cargo 3] [--csv prefixo]");
    process.exit(1);
  }
  const c = String(codigoCargo).padStart(4, "0");

  // nomes dos candidatos e totais oficiais de Manaus, para conferência
  const totalMun = await buscar(`${baseResultados}/dados/${UF}/${UF}${MUNICIPIO}-c${c}-e00${ELEICAO}-u.json`, "json");
  const cands = {};
  for (const cg of totalMun?.carg || []) for (const a of cg.agr || []) for (const p of a.par || [])
    for (const cd of p.cand || []) cands[cd.n] = { nome: cd.nmu, partido: p.sg, votos: Number(cd.vap) };
  const nomeCurto = n => (cands[n] ? nomeProprio(cands[n].nome) : n);

  // seção → bairro → zona administrativa
  const locais = lerCsvLocal("locais-secao-2026-am-manaus.csv");
  const porSecao = new Map(locais.map(r => [`${Number(r.zona)}-${Number(r.secao)}`, r]));
  const porLocal = new Map(locais.map(r => [Number(r.local), r]));
  const zonaAdm = new Map(lerCsvLocal("zonas-administrativas-manaus.csv").map(r => [r.bairro, r.zona_administrativa]));

  const config = await buscar(`${baseUrna}/config/${UF}/${UF}-p00${PLEITO}-cs.json`, "json");
  const mu = config.abr[0].mu.find(m => m.cd === MUNICIPIO);
  const lista = mu.zon.flatMap(z => z.sec.map(s => ({ zona: Number(z.cd), secao: Number(s.ns) })));
  console.log(`${totalMun?.carg?.[0]?.nmn || `Cargo ${codigoCargo}`} — Manaus — ${lista.length} seções`);

  let feitas = 0, semBoletim = 0;
  const lidas = await emParalelo(lista, 12, async ({ zona, secao }) => {
    const r = await lerSecao(zona, secao, codigoCargo).catch(e => {
      console.warn(`Zona ${zona}, seção ${secao}: erro (${e.message})`);
      return undefined;
    });
    if (++feitas % 500 === 0) console.log(`  ${feitas}/${lista.length} seções lidas`);
    if (r === null) semBoletim++;
    if (!r) return null;
    const info = porSecao.get(`${zona}-${secao}`) || porLocal.get(r.local);
    const bairro = info?.bairro || "SEM BAIRRO";
    return {
      zona, secao, local: r.local, nome_local: info?.nome_local || "",
      bairro, zona_administrativa: zonaAdm.get(bairro) || "Não classificado",
      aptos: r.aptos,
      validos: Object.values(r.votos).reduce((s, v) => s + v, 0) + r.legenda,
      votos: r.votos,
    };
  });
  const secoes = lidas.filter(Boolean);
  const erros = lidas.length - secoes.length - semBoletim;
  console.log(`Boletins lidos: ${secoes.length} | sem boletim próprio (agregadas): ${semBoletim}` +
    (erros ? ` | ERROS: ${erros}` : ""));

  // conferência com o total oficial de Manaus
  for (const n of numeros) {
    const soma = secoes.reduce((s, x) => s + (x.votos[n] || 0), 0);
    console.log(`  ${n} ${cands[n]?.nome}/${cands[n]?.partido}: ${soma} votos nas seções | Manaus no TSE: ${cands[n]?.votos}` +
      (soma === cands[n]?.votos ? " (confere)" : " (DIFERENTE)"));
  }

  const linha = (g) => {
    const l = { secoes: g.secoes, locais: g.locais.size, aptos: g.aptos, validos: g.validos };
    for (const n of numeros) {
      l[`votos_${n}`] = g.votos[n];
      l[`pct_${n}`] = pct(g.votos[n], g.validos);
    }
    if (numeros.length >= 2) {
      const [a, b] = numeros;
      l.diferenca = g.votos[a] - g.votos[b];
      l.mais_votado = l.diferenca > 0 ? nomeCurto(a) : l.diferenca < 0 ? nomeCurto(b) : "Empate";
    }
    return l;
  };

  const ordemZonas = ["Norte", "Leste", "Oeste", "Centro-Oeste", "Sul", "Centro-Sul", "Rural", "Não classificado"];
  const zonas = [...agrupar(secoes, s => s.zona_administrativa, numeros)]
    .map(([zona, g]) => ({ zona_administrativa: zona, ...linha(g) }))
    .sort((x, y) => ordemZonas.indexOf(x.zona_administrativa) - ordemZonas.indexOf(y.zona_administrativa));
  const bairros = [...agrupar(secoes, s => `${s.zona_administrativa}|${s.bairro}`, numeros)]
    .map(([k, g]) => ({ zona_administrativa: k.split("|")[0], bairro: nomeProprio(k.split("|")[1]), ...linha(g) }))
    .sort((x, y) => ordemZonas.indexOf(x.zona_administrativa) - ordemZonas.indexOf(y.zona_administrativa) || y.aptos - x.aptos);
  const total = linha([...agrupar(secoes, () => "total", numeros).values()][0]);

  console.log("\nPOR ZONA ADMINISTRATIVA");
  console.table(zonas);
  console.log("\nPOR BAIRRO");
  console.table(bairros);

  if (prefixo) {
    const colunasVotos = numeros.flatMap(n => [`Votos ${nomeCurto(n)} (${n})`, `% válidos ${nomeCurto(n)}`]);
    const extra = numeros.length >= 2
      ? [`Diferença (${nomeCurto(numeros[0])} − ${nomeCurto(numeros[1])})`, "Mais votado entre os dois"] : [];
    const valores = l => [l.secoes, l.locais, l.aptos, l.validos,
      ...numeros.flatMap(n => [l[`votos_${n}`], decimal(l[`pct_${n}`])]),
      ...(numeros.length >= 2 ? [l.diferenca, campo(l.mais_votado)] : [])];
    const cab = ["Seções", "Locais de votação", "Eleitores aptos", "Votos válidos", ...colunasVotos, ...extra];

    salvarCsv(`${prefixo}-zonas-administrativas.csv`, ["Zona administrativa", ...cab], [
      ...zonas.map(z => [campo(z.zona_administrativa), ...valores(z)].join(";")),
      ["TOTAL MANAUS", ...valores(total)].join(";"),
    ]);
    salvarCsv(`${prefixo}-bairros.csv`, ["Zona administrativa", "Bairro", ...cab], [
      ...bairros.map(b => [campo(b.zona_administrativa), campo(b.bairro), ...valores(b)].join(";")),
      ["TOTAL MANAUS", "", ...valores(total)].join(";"),
    ]);
    salvarCsv(`${prefixo}-secoes.csv`,
      ["Zona eleitoral", "Seção", "Nº local", "Local de votação", "Bairro", "Zona administrativa", "Eleitores aptos", "Votos válidos",
        ...numeros.flatMap(n => [`Votos ${nomeCurto(n)} (${n})`, `% válidos ${nomeCurto(n)}`])],
      secoes.map(s => [s.zona, s.secao, s.local, campo(s.nome_local), campo(nomeProprio(s.bairro)), campo(s.zona_administrativa),
        s.aptos, s.validos, ...numeros.flatMap(n => [s.votos[n] || 0, decimal(pct(s.votos[n] || 0, s.validos))])].join(";")));
  }
})();
