// Votos de um candidato por município de um estado em 2026, comparados com 2022.
// Uso: node tse-municipios.js <numero2026> [--uf am] [--numero2022 4455] [--csv arquivo.csv]
//   O cargo vem do tamanho do número: 4 dígitos = Deputado Federal, 5 dígitos = Deputado Estadual.
//
// Fontes:
//   2026 - site de resultados do TSE (arquivo de cada município).
//   2022 - dados/votos-2022-<uf>-municipio.csv e dados/aptos-2022-<uf>-municipio.csv, extraídos de
//          votacao_candidato_munzona_2022 e detalhe_votacao_munzona_2022 (Portal de Dados Abertos do TSE).

const fs = require("fs");
const path = require("path");

const ELEICAO = 6259;
const base = `https://resultados.tse.jus.br/oficial/ele2026/${ELEICAO}`;

const cargos = {
  4: { codigo: 6, nome: "Deputado Federal" },
  5: { codigo: 7, nome: "Deputado Estadual" },
};

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function lerCsvLocal(nome) {
  const caminho = path.join(__dirname, "dados", nome);
  if (!fs.existsSync(caminho)) return [];
  const [cabecalho, ...linhas] = fs.readFileSync(caminho, "utf8").trim().split(/\r?\n/);
  const colunas = cabecalho.split(";");
  return linhas.map(l => {
    const valores = l.split(";");
    return Object.fromEntries(colunas.map((c, i) => [c, valores[i]]));
  });
}

async function buscarJson(url) {
  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    try {
      const resposta = await fetch(url, { cache: "no-store" });
      if (resposta.status === 404) return null;
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      return await resposta.json();
    } catch (erro) {
      if (tentativa === 4) throw erro;
      await new Promise(r => setTimeout(r, 1000 * 2 ** tentativa));
    }
  }
}

function acharCandidato(dados, codigoCargo, numero) {
  for (const cargo of dados?.carg || []) {
    if (Number(cargo.cd) !== codigoCargo) continue;
    for (const agr of cargo.agr || []) for (const par of agr.par || []) for (const cand of par.cand || []) {
      if (String(cand.n) === numero) return { ...cand, sg: par.sg };
    }
  }
  return null;
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

const pct = (v, total) => (total ? Number((v / total * 100).toFixed(2)) : 0);
const variacao = (atual, anterior) => (anterior ? Number(((atual / anterior - 1) * 100).toFixed(1)) : null);
const decimal = (v, casas = 2) => (v == null ? "" : Number(v).toFixed(casas).replace(".", ","));
const campo = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

(async () => {
  const numero = process.argv.slice(2).find((a, i, args) => /^\d+$/.test(a) && !String(args[i - 1]).startsWith("--"));
  const uf = String(argumento("--uf", "am")).toLowerCase();
  const cargo = numero ? cargos[numero.length] : null;
  if (!cargo) {
    console.error("Uso: node tse-municipios.js <numero2026> [--uf am] [--numero2022 4455] [--csv arquivo.csv]");
    console.error("Número com 4 dígitos (Deputado Federal) ou 5 dígitos (Deputado Estadual).");
    process.exit(1);
  }
  const numero2022 = String(argumento("--numero2022", numero));
  if (cargos[numero2022.length]?.codigo !== cargo.codigo) {
    console.error(`O número de 2022 (${numero2022}) precisa ser do mesmo cargo (mesma quantidade de dígitos).`);
    process.exit(1);
  }
  const c = String(cargo.codigo).padStart(4, "0");

  // municípios do estado
  const config = await buscarJson(`${base}/config/mun-e00${ELEICAO}-cm.json`);
  const estado = config.abr.find(a => a.cd.toLowerCase() === uf);
  if (!estado) {
    console.error(`UF "${uf}" não encontrada.`);
    process.exit(1);
  }

  // situação final do candidato no estado
  const totalEstado = await buscarJson(`${base}/dados/${uf}/${uf}-c${c}-e00${ELEICAO}-u.json`);
  const candEstado = acharCandidato(totalEstado, cargo.codigo, numero);

  // 2022
  const votos2022 = lerCsvLocal(`votos-2022-${uf}-municipio.csv`)
    .filter(r => Number(r.cargo) === cargo.codigo && r.numero === numero2022);
  const aptos2022 = Object.fromEntries(lerCsvLocal(`aptos-2022-${uf}-municipio.csv`)
    .filter(r => Number(r.cargo) === cargo.codigo)
    .map(r => [Number(r.municipio), Number(r.aptos)]));
  const cand2022 = votos2022[0] || null;
  const votosPorMun2022 = Object.fromEntries(votos2022.map(r => [Number(r.municipio), Number(r.votos)]));
  const tem2022 = Object.keys(aptos2022).length > 0;

  const lidos = await emParalelo(estado.mu, 6, async mu => {
    const dados = await buscarJson(`${base}/dados/${uf}/${uf}${mu.cd}-c${c}-e00${ELEICAO}-u.json`);
    if (!dados) {
      console.warn(`Erro no município ${mu.nm}`);
      return null;
    }
    const cand = acharCandidato(dados, cargo.codigo, numero);
    const votos = Number(cand?.vap || 0);
    const aptos = Number(dados.e?.te || 0);
    const cod = Number(mu.cd);
    const v22 = tem2022 ? (cand2022 ? (votosPorMun2022[cod] || 0) : 0) : null;
    const a22 = aptos2022[cod] ?? null;
    return {
      municipio: mu.nm,
      votos_2026: votos,
      aptos_2026: aptos,
      pct_aptos_2026: pct(votos, aptos),
      votos_2022: v22,
      aptos_2022: a22,
      pct_aptos_2022: v22 != null && a22 ? pct(v22, a22) : null,
      variacao_votos: v22 != null ? votos - v22 : null,
      variacao_pct: v22 != null ? variacao(votos, v22) : null,
      _nome: cand ? `${cand.nmu}/${cand.sg}` : null,
      _secoes: dados.s?.pst,
    };
  });

  const resultado = lidos.filter(Boolean).sort((a, b) => b.votos_2026 - a.votos_2026);
  const nome2026 = candEstado ? `${candEstado.nmu}/${candEstado.sg}` : resultado.find(r => r._nome)?._nome;
  const incompletos = resultado.filter(r => r._secoes && r._secoes !== "100,00")
    .map(r => `${r.municipio} (${r._secoes}%)`);
  resultado.forEach(r => { delete r._nome; delete r._secoes; });

  const soma = k => resultado.reduce((s, r) => s + (r[k] || 0), 0);
  const t = {
    votos26: soma("votos_2026"), aptos26: soma("aptos_2026"),
    votos22: soma("votos_2022"), aptos22: soma("aptos_2022"),
  };

  console.log(`Candidato ${numero} — ${cargo.nome} — ${estado.ds || uf.toUpperCase()} (${resultado.length} municípios)`);
  console.log(`2026: ${nome2026 || "não encontrado"}${candEstado?.st ? ` — ${candEstado.st}` : ""}`);
  console.log(cand2022
    ? `2022 (nº ${numero2022}): ${cand2022.nome_urna}/${cand2022.partido} — ${cand2022.situacao}`
    : `2022: nenhum candidato com o número ${numero2022}`);
  if (totalEstado?.s?.pst && totalEstado.s.pst !== "100,00") {
    console.warn(`Atenção: totalização 2026 em andamento — ${totalEstado.s.pst}% das seções do estado totalizadas.`);
  }
  if (incompletos.length) console.warn(`Municípios ainda não 100% totalizados: ${incompletos.join(", ")}`);
  console.table(resultado);
  console.log(`TOTAL 2026: ${t.votos26} votos | ${t.aptos26} aptos | ${decimal(pct(t.votos26, t.aptos26))}%`);
  if (cand2022) {
    console.log(`TOTAL 2022: ${t.votos22} votos | ${t.aptos22} aptos | ${decimal(pct(t.votos22, t.aptos22))}%`);
    console.log(`VARIAÇÃO: ${t.votos26 - t.votos22 >= 0 ? "+" : ""}${t.votos26 - t.votos22} votos (${decimal(variacao(t.votos26, t.votos22), 1)}%)`);
  }
  if (candEstado && Number(candEstado.vap) !== t.votos26) {
    console.warn(`Atenção: soma dos municípios (${t.votos26}) diferente do total do estado (${candEstado.vap}).`);
  }

  if (process.argv.includes("--csv")) {
    const arquivo = argumento("--csv", `resultado-municipios-${uf}-${numero}.csv`);
    const cabecalho = ["Município", "Votos 2026", "Eleitores aptos 2026", "% dos aptos 2026",
      "Votos 2022", "Eleitores aptos 2022", "% dos aptos 2022", "Variação de votos", "Variação %"];
    const linhas = resultado.map(r => [
      campo(r.municipio), r.votos_2026, r.aptos_2026, decimal(r.pct_aptos_2026),
      r.votos_2022 ?? "", r.aptos_2022 ?? "", decimal(r.pct_aptos_2022),
      r.variacao_votos ?? "", decimal(r.variacao_pct, 1),
    ].join(";"));
    linhas.push(["TOTAL", t.votos26, t.aptos26, decimal(pct(t.votos26, t.aptos26)),
      cand2022 ? t.votos22 : "", t.aptos22 || "", cand2022 ? decimal(pct(t.votos22, t.aptos22)) : "",
      cand2022 ? t.votos26 - t.votos22 : "", cand2022 ? decimal(variacao(t.votos26, t.votos22), 1) : ""].join(";"));
    fs.writeFileSync(arquivo, "﻿" + [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n");
    console.log("CSV salvo em", arquivo);
  }
})();
