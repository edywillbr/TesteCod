// Seções eleitorais do Brasil (e exterior) em que um candidato a Presidente não teve nenhum voto em 2026,
// com o local de votação de cada seção.
// Uso: node tse-secoes-sem-voto.js <numero> [--turno 1|2] [--uf SP,RJ] [--cache pasta] [--manter] [--csv prefixo]
//   --turno   1 ou 2 (padrão: 2)
//   --uf      limita a análise a algumas UFs (padrão: todas, incluindo ZZ = exterior)
//   --cache   pasta onde os arquivos do TSE são baixados (padrão: ./cache-tse)
//   --manter  não apaga os boletins já processados (o 1º turno de SP sozinho tem 1,4 GB)
//
// Fontes (Portal de Dados Abertos do TSE):
//   Boletins de urna - resultados-2026-boletim-de-urna (bweb_<turno>t_<UF>_*.zip). O boletim só traz
//     linhas de votáveis com voto na seção, então a seção sem linha do candidato é uma seção com zero votos.
//   Locais de votação - eleitorado_local_votacao_2026 (nome, endereço, bairro, tipo e coordenadas).

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn, execFileSync } = require("child_process");

const CKAN = "https://dadosabertos.tse.jus.br/api/3/action/package_show?id=resultados-2026-boletim-de-urna";
const URL_LOCAIS = "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip";
const CARGO_PRESIDENTE = "1";

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const numero = process.argv[2];
if (!/^\d{2}$/.test(numero || "")) {
  console.error("Uso: node tse-secoes-sem-voto.js <numero> [--turno 1|2] [--uf SP,RJ] [--cache pasta] [--manter] [--csv prefixo]");
  process.exit(1);
}
const turno = argumento("--turno", "2");
const ufsFiltro = argumento("--uf", "") ? argumento("--uf").toUpperCase().split(",") : null;
const cache = path.resolve(argumento("--cache", "cache-tse"));
const manter = process.argv.includes("--manter");
const prefixo = argumento("--csv", `presidente-${numero}-secoes-sem-voto-${turno}t`);
fs.mkdirSync(cache, { recursive: true });

// ---------- Download e leitura dos arquivos ----------

function baixar(url, destino) {
  if (fs.existsSync(destino)) return;
  console.log("Baixando", url);
  execFileSync("curl", ["-sS", "--fail", "--retry", "5", "-o", destino + ".parcial", url], { stdio: "inherit" });
  fs.renameSync(destino + ".parcial", destino);
}

// Lê, linha a linha, os CSVs (latin1, ";" e aspas) de dentro de um zip, sem extrair para o disco.
async function* linhasDoZip(zip, padrao) {
  const unzip = spawn("unzip", ["-p", zip, padrao]);
  unzip.stdout.setEncoding("latin1");
  const rl = readline.createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  let colunas = null;
  for await (const linha of rl) {
    const valores = linha.split(";").map(v => v.replace(/^"|"$/g, ""));
    if (valores[0] === "DT_GERACAO") { colunas = valores; continue; }
    yield Object.fromEntries(colunas.map((c, i) => [c, valores[i]]));
  }
}

const chave = (uf, municipio, zona, secao) => `${uf}|${Number(municipio)}|${Number(zona)}|${Number(secao)}`;

async function lerLocais() {
  const zip = path.join(cache, "eleitorado_local_votacao_2026.zip");
  baixar(URL_LOCAIS, zip);
  const locais = new Map();
  for await (const r of linhasDoZip(zip, "eleitorado_local_votacao_2026_BRASIL.csv")) {
    if (r.NR_TURNO !== turno) continue;
    if (ufsFiltro && !ufsFiltro.includes(r.SG_UF)) continue;
    locais.set(chave(r.SG_UF, r.CD_MUNICIPIO, r.NR_ZONA, r.NR_SECAO), {
      nome: r.NM_LOCAL_VOTACAO, tipo: r.DS_TIPO_LOCAL, endereco: r.DS_ENDERECO, bairro: r.NM_BAIRRO,
      latitude: r.NR_LATITUDE, longitude: r.NR_LONGITUDE, localidade: r.DS_SITU_LOCALIDADE,
    });
  }
  return locais;
}

function urlsBoletins() {
  // Pelo curl: o fetch do Node recebe do portal uma versão em cache da lista, sem o 2º turno.
  const { result } = JSON.parse(execFileSync("curl", ["-sS", "--fail", "--retry", "5", CKAN], { encoding: "utf8" }));
  return result.resources
    .map(r => r.url)
    .filter(u => new RegExp(`/bweb_${turno}t_[A-Z]{2}_\\d+\\.zip$`).test(u))
    .filter(u => !ufsFiltro || ufsFiltro.includes(u.match(/_([A-Z]{2})_\d+\.zip$/)[1]));
}

// Votos para Presidente por seção, a partir do boletim de urna de uma UF.
async function lerBoletins(url, secoes, candidatos) {
  const zip = path.join(cache, path.basename(url));
  baixar(url, zip);
  for await (const r of linhasDoZip(zip, "*.csv")) {
    if (r.CD_CARGO_PERGUNTA !== CARGO_PRESIDENTE) continue;
    const k = chave(r.SG_UF, r.CD_MUNICIPIO, r.NR_ZONA, r.NR_SECAO);
    let s = secoes.get(k);
    if (!s) {
      s = {
        uf: r.SG_UF, municipio: r.NM_MUNICIPIO, zona: Number(r.NR_ZONA), secao: Number(r.NR_SECAO),
        local: Number(r.NR_LOCAL_VOTACAO), aptos: Number(r.QT_APTOS), comparecimento: Number(r.QT_COMPARECIMENTO),
        tipoUrna: r.DS_TIPO_URNA, agregadas: r.DS_SECOES_AGREGADAS === "#NULO#" ? "" : r.DS_SECOES_AGREGADAS,
        votos: {}, brancos: 0, nulos: 0,
      };
      secoes.set(k, s);
    }
    const qtd = Number(r.QT_VOTOS);
    if (r.CD_TIPO_VOTAVEL === "1") {
      s.votos[r.NR_VOTAVEL] = (s.votos[r.NR_VOTAVEL] || 0) + qtd;
      candidatos[r.NR_VOTAVEL] = r.NM_VOTAVEL;
    } else if (r.CD_TIPO_VOTAVEL === "2") s.brancos += qtd;
    else if (r.CD_TIPO_VOTAVEL === "3") s.nulos += qtd;
  }
  if (!manter) fs.unlinkSync(zip);
}

// ---------- Saída ----------

const minusculas = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);
const nomeProprio = t => String(t || "").toLowerCase().split(" ")
  .map((p, i) => (i > 0 && minusculas.has(p.toUpperCase()) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
  .join(" ");
const csvTexto = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

function salvarCsv(arquivo, cabecalho, linhas) {
  fs.writeFileSync(arquivo, "﻿" + [cabecalho.join(";"), ...linhas.map(l => l.join(";"))].join("\r\n") + "\r\n");
  console.log("CSV salvo em", arquivo);
}

(async () => {
  const urls = urlsBoletins();
  if (!urls.length) throw new Error(`Nenhum boletim de urna encontrado para o ${turno}º turno`);
  console.log("Lendo os locais de votação...");
  const locais = await lerLocais();

  const secoes = new Map();
  const candidatos = {};
  for (const url of urls) {
    await lerBoletins(url, secoes, candidatos);
    console.log(`  ${path.basename(url)}: ${secoes.size.toLocaleString("pt-BR")} seções lidas até agora`);
  }
  if (!candidatos[numero]) throw new Error(`O número ${numero} não teve votos para Presidente no ${turno}º turno`);
  const outros = Object.keys(candidatos).filter(n => n !== numero)
    .sort((a, b) => [...secoes.values()].reduce((t, s) => t + (s.votos[b] || 0) - (s.votos[a] || 0), 0));

  const zeradas = [...secoes.entries()]
    .filter(([, s]) => !s.votos[numero])
    .map(([k, s]) => ({ ...s, ...(locais.get(k) || {}) }))
    .sort((a, b) => a.uf.localeCompare(b.uf) || a.municipio.localeCompare(b.municipio) || a.zona - b.zona || a.secao - b.secao);

  console.log(`\n${candidatos[numero]} (${numero}) - ${turno}º turno: ${zeradas.length} seções sem nenhum voto,`
    + ` de ${secoes.size.toLocaleString("pt-BR")} seções com boletim de urna.\n`);

  // Por seção
  salvarCsv(`${prefixo}.csv`,
    ["UF", "Municipio", "Zona", "Secao", "Secoes agregadas", "Local", "Nome do local", "Tipo do local", "Localidade",
      "Endereco", "Bairro", "Latitude", "Longitude", "Tipo de urna", "Aptos", "Comparecimento",
      ...outros.map(n => `${candidatos[n]} (${n})`), "Brancos", "Nulos"],
    zeradas.map(s => [s.uf, csvTexto(nomeProprio(s.municipio)), s.zona, s.secao, csvTexto(s.agregadas), s.local,
      csvTexto(s.nome), csvTexto(s.tipo), csvTexto(s.localidade), csvTexto(s.endereco), csvTexto(s.bairro),
      s.latitude, s.longitude, csvTexto(s.tipoUrna), s.aptos, s.comparecimento,
      ...outros.map(n => s.votos[n] || 0), s.brancos, s.nulos]));

  // Por local de votação: seções zeradas e total de seções do local
  const secoesPorLocal = new Map();
  for (const s of secoes.values()) {
    const k = `${s.uf}|${s.municipio}|${s.zona}|${s.local}`;
    secoesPorLocal.set(k, (secoesPorLocal.get(k) || 0) + 1);
  }
  const porLocal = new Map();
  for (const s of zeradas) {
    const k = `${s.uf}|${s.municipio}|${s.zona}|${s.local}`;
    if (!porLocal.has(k)) porLocal.set(k, { ...s, secoes: [], aptos: 0, comparecimento: 0, votos: {} });
    const l = porLocal.get(k);
    l.secoes.push(s.secao);
    l.aptos += s.aptos;
    l.comparecimento += s.comparecimento;
    for (const n of outros) l.votos[n] = (l.votos[n] || 0) + (s.votos[n] || 0);
  }
  salvarCsv(`${prefixo}-locais.csv`,
    ["UF", "Municipio", "Zona", "Local", "Nome do local", "Tipo do local", "Localidade", "Endereco", "Bairro",
      "Latitude", "Longitude", "Secoes sem voto", "Secoes no local", "Lista de secoes", "Aptos", "Comparecimento",
      ...outros.map(n => `${candidatos[n]} (${n})`)],
    [...porLocal.values()].map(l => [l.uf, csvTexto(nomeProprio(l.municipio)), l.zona, l.local, csvTexto(l.nome),
      csvTexto(l.tipo), csvTexto(l.localidade), csvTexto(l.endereco), csvTexto(l.bairro), l.latitude, l.longitude,
      l.secoes.length, secoesPorLocal.get(`${l.uf}|${l.municipio}|${l.zona}|${l.local}`), csvTexto(l.secoes.join(", ")),
      l.aptos, l.comparecimento, ...outros.map(n => l.votos[n] || 0)]));

  // Resumo por UF no terminal
  const porUf = {};
  for (const s of zeradas) porUf[s.uf] = (porUf[s.uf] || 0) + 1;
  console.table(Object.entries(porUf).sort((a, b) => b[1] - a[1])
    .map(([uf, qtd]) => ({ UF: uf, "Seções sem voto": qtd })));
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
