// Migração de votos para Presidente entre o 1º e o 2º turno de 2026, por estado e por município.
// Uso: node tse-migracao-presidente.js [--uf SP,RJ] [--top 10] [--cache pasta] [--saida pasta]
//   --uf     limita a algumas UFs (padrão: todas, incluindo ZZ = exterior)
//   --top    quantos municípios por estado em cada ranking (padrão: 10)
//   --cache  pasta onde os arquivos do TSE são baixados (padrão: ./cache-tse)
//   --saida  pasta dos CSVs e do JSON gerados (padrão: pasta atual)
//
// Método (inferência ecológica): em cada seção eleitoral, a composição do eleitorado no 1º turno
// (Lula, Flávio, Cury, Renan, Caiado, outros, branco/nulo e abstenção, como fração dos aptos) e no 2º turno
// (Lula, Flávio, branco/nulo e abstenção) é conhecida. Estima-se, para cada estado, a matriz de transferência
// que melhor explica o 2º turno a partir do 1º em todas as seções (mínimos quadrados ponderados pelos aptos,
// cada linha da matriz com valores entre 0 e 1 somando 1). Para os municípios, a mesma estimativa é feita com as
// seções do município, puxada para a matriz do estado (o peso da matriz do estado equivale a ~10 seções), o que
// evita resultados extremos em municípios pequenos. Os fluxos em votos são ajustados (IPF) para bater com os
// totais reais dos dois turnos. São estimativas estatísticas: não é possível saber o voto de cada eleitor.
//
// Fontes (Portal de Dados Abertos do TSE):
//   votacao_secao_2026_BR          - votos de cada candidato a Presidente por seção, nos dois turnos
//   detalhe_votacao_secao_2026     - aptos, comparecimento, brancos e nulos por seção
//   eleitorado_local_votacao_2026  - coordenadas dos locais de votação (centro aproximado de cada município)

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn, execFileSync } = require("child_process");
const { nomeProprio } = require("./lib/boletim");

const ODSELE = "https://cdn.tse.jus.br/estatistica/sead/odsele";
const ARQUIVOS = {
  votos: `${ODSELE}/votacao_secao/votacao_secao_2026_BR.zip`,
  detalhe: `${ODSELE}/detalhe_votacao_secao/detalhe_votacao_secao_2026.zip`,
  locais: `${ODSELE}/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip`,
};

// Categorias do 1º turno (origem) e do 2º turno (destino).
const ORIGENS = [
  { id: "lula", nome: "Lula", numeros: ["13"] },
  { id: "flavio", nome: "Flávio Bolsonaro", numeros: ["22"] },
  { id: "cury", nome: "Augusto Cury", numeros: ["70"] },
  { id: "renan", nome: "Renan Santos", numeros: ["14"] },
  { id: "caiado", nome: "Ronaldo Caiado", numeros: ["55"] },
  { id: "outros", nome: "Outros candidatos", numeros: null },
  { id: "branco_nulo", nome: "Branco/Nulo" },
  { id: "abstencao", nome: "Abstenção" },
];
const DESTINOS = [
  { id: "lula", nome: "Lula" },
  { id: "flavio", nome: "Flávio Bolsonaro" },
  { id: "branco_nulo", nome: "Branco/Nulo" },
  { id: "abstencao", nome: "Abstenção" },
];
const NO = ORIGENS.length, ND = DESTINOS.length;
const IDX_OUTROS = ORIGENS.findIndex(o => o.id === "outros");
const idxOrigem = {};
ORIGENS.forEach((o, i) => (o.numeros || []).forEach(n => (idxOrigem[n] = i)));
const idxDestino = { 13: 0, 22: 1 };
// Fluxos que não são migração: o eleitor ficou onde estava.
const permanece = (i, k) => ORIGENS[i].id === DESTINOS[k].id;

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const ufsFiltro = argumento("--uf", "") ? argumento("--uf").toUpperCase().split(",") : null;
const TOP = Number(argumento("--top", "10"));
const cache = path.resolve(argumento("--cache", "cache-tse"));
const saida = path.resolve(argumento("--saida", "."));
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(saida, { recursive: true });

// ---------- Download e leitura dos arquivos ----------

function baixar(url) {
  const destino = path.join(cache, path.basename(url));
  if (fs.existsSync(destino)) return destino;
  console.log("Baixando", url);
  execFileSync("curl", ["-sS", "--fail", "--retry", "5", "-o", destino + ".parcial", url], { stdio: "inherit" });
  fs.renameSync(destino + ".parcial", destino);
  return destino;
}

// Lê, linha a linha, um CSV (latin1, ";" e aspas) de dentro de um zip, sem extrair para o disco.
// Entrega arrays de valores e o índice das colunas, que é mais rápido que montar um objeto por linha.
async function lerZip(zip, arquivo, fn) {
  const unzip = spawn("unzip", ["-p", zip, arquivo]);
  unzip.stdout.setEncoding("latin1");
  const rl = readline.createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  let col = null, n = 0;
  for await (const linha of rl) {
    const v = linha.split(";").map(x => (x.charCodeAt(0) === 34 ? x.slice(1, -1) : x));
    if (!col) { col = Object.fromEntries(v.map((c, i) => [c, i])); continue; }
    fn(v, col);
    if (++n % 2e6 === 0) console.log(`  ${(n / 1e6).toFixed(0)} milhões de linhas`);
  }
}

const chave = (uf, municipio, zona, secao) => `${uf}|${Number(municipio)}|${Number(zona)}|${Number(secao)}`;
const aceitaUf = uf => !ufsFiltro || ufsFiltro.includes(uf);

// ---------- Álgebra: mínimos quadrados com linhas no simplex ----------

// Projeção de um vetor no simplex {x >= 0, soma = 1}.
function projetarSimplex(v) {
  const u = [...v].sort((a, b) => b - a);
  let soma = 0, theta = 0;
  for (let i = 0; i < u.length; i++) {
    soma += u[i];
    const t = (soma - 1) / (i + 1);
    if (u[i] - t > 0) theta = t;
  }
  return v.map(x => Math.max(0, x - theta));
}

// Minimiza tr(BᵀGB) - 2tr(BᵀC) + λ‖B - B0‖² com cada linha de B no simplex (FISTA).
// G = Σ w·x·xᵀ (NO×NO), C = Σ w·x·yᵀ (NO×ND).
function estimarMatriz(G, C, lambda = 0, B0 = null) {
  let traco = 0;
  for (let i = 0; i < NO; i++) traco += G[i][i];
  const L = 2 * (traco + lambda) || 1;
  let B = B0 ? B0.map(r => [...r]) : Array.from({ length: NO }, () => Array(ND).fill(1 / ND));
  let Y = B.map(r => [...r]), t = 1;
  for (let it = 0; it < 4000; it++) {
    const novo = [];
    for (let i = 0; i < NO; i++) {
      const g = Array(ND).fill(0);
      for (let k = 0; k < ND; k++) {
        let s = -C[i][k];
        for (let j = 0; j < NO; j++) s += G[i][j] * Y[j][k];
        g[k] = 2 * s + (B0 ? 2 * lambda * (Y[i][k] - B0[i][k]) : 0);
      }
      novo.push(projetarSimplex(Y[i].map((y, k) => y - g[k] / L)));
    }
    const t2 = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
    let delta = 0;
    Y = novo.map((r, i) => r.map((x, k) => {
      delta = Math.max(delta, Math.abs(x - B[i][k]));
      return x + ((t - 1) / t2) * (x - B[i][k]);
    }));
    B = novo; t = t2;
    if (delta < 1e-9) break;
  }
  return B;
}

// Ajusta os fluxos (IPF) para que as linhas somem os totais do 1º turno e as colunas os do 2º.
function ajustarFluxos(F, linhas, colunas) {
  const somaCol = colunas.reduce((a, b) => a + b, 0), somaLin = linhas.reduce((a, b) => a + b, 0);
  const alvoCol = colunas.map(c => (c * somaLin) / (somaCol || 1));
  for (let it = 0; it < 200; it++) {
    for (let i = 0; i < NO; i++) {
      const s = F[i].reduce((a, b) => a + b, 0);
      if (s > 0) F[i] = F[i].map(x => (x * linhas[i]) / s);
    }
    for (let k = 0; k < ND; k++) {
      const s = F.reduce((a, r) => a + r[k], 0);
      if (s > 0) for (let i = 0; i < NO; i++) F[i][k] *= alvoCol[k] / s;
    }
  }
  return F;
}

const zeros = (n, m) => Array.from({ length: n }, () => Array(m).fill(0));

// Acumula G e C de um conjunto de seções.
function acumular(secoes) {
  const G = zeros(NO, NO), C = zeros(NO, ND);
  for (const s of secoes) {
    const w = s.a1, x = s.x.map(v => v / s.a1), y = s.y.map(v => v / s.a2);
    for (let i = 0; i < NO; i++) {
      if (!x[i]) continue;
      for (let j = 0; j < NO; j++) G[i][j] += w * x[i] * x[j];
      for (let k = 0; k < ND; k++) C[i][k] += w * x[i] * y[k];
    }
  }
  return { G, C };
}

// Fluxos estimados em votos de um conjunto de seções, a partir da matriz B.
function fluxos(secoes, B) {
  const linhas = Array(NO).fill(0), colunas = Array(ND).fill(0);
  for (const s of secoes) {
    s.x.forEach((v, i) => (linhas[i] += v));
    s.y.forEach((v, k) => (colunas[k] += v));
  }
  const F = linhas.map((v, i) => B[i].map(b => v * b));
  return { F: ajustarFluxos(F, linhas, colunas), linhas, colunas };
}

// Qualidade do ajuste: erro médio (pontos percentuais) do 2º turno previsto por seção.
function erroMedio(secoes, B) {
  let soma = 0, peso = 0;
  for (const s of secoes) {
    const x = s.x.map(v => v / s.a1), y = s.y.map(v => v / s.a2);
    for (let k = 0; k < ND; k++) {
      let p = 0;
      for (let i = 0; i < NO; i++) p += x[i] * B[i][k];
      soma += s.a1 * Math.abs(p - y[k]);
    }
    peso += s.a1 * ND;
  }
  return (100 * soma) / peso;
}

// ---------- Saída ----------

const csvTexto = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
const n0 = v => Math.round(v);
const pct = v => (Number.isFinite(v) ? (100 * v).toFixed(1).replace(".", ",") : "");
const dec = v => (v == null ? "" : String(v).replace(".", ","));

function salvarCsv(nome, cabecalho, linhas) {
  const arquivo = path.join(saida, nome);
  fs.writeFileSync(arquivo, "﻿" + [cabecalho.join(";"), ...linhas.map(l => l.join(";"))].join("\r\n") + "\r\n");
  console.log("CSV salvo em", arquivo);
}

// Resumo de um território (estado ou município) a partir dos fluxos.
function resumir({ F, linhas, colunas }) {
  const [l1, f1] = [linhas[0], linhas[1]], [l2, f2] = [colunas[0], colunas[1]];
  const validos1 = linhas.slice(0, NO - 2).reduce((a, b) => a + b, 0), validos2 = l2 + f2;
  const margem1 = validos1 ? (l1 - f1) / validos1 : 0, margem2 = validos2 ? (l2 - f2) / validos2 : 0;
  let movimento = 0;
  const lista = [];
  for (let i = 0; i < NO; i++) for (let k = 0; k < ND; k++) {
    if (permanece(i, k)) continue;
    movimento += F[i][k];
    lista.push({ origem: ORIGENS[i].nome, destino: DESTINOS[k].nome, votos: F[i][k] });
  }
  lista.sort((a, b) => b.votos - a.votos);
  const vence = (a, b) => (a > b ? "Lula" : a < b ? "Flávio Bolsonaro" : "Empate");
  return {
    lula1: l1, flavio1: f1, lula2: l2, flavio2: f2, deltaLula: l2 - l1, deltaFlavio: f2 - f1,
    margem1, margem2, variacaoMargem: margem2 - margem1,
    vencedor1: vence(l1, f1), vencedor2: vence(l2, f2), virada: vence(l1, f1) !== vence(l2, f2),
    movimento, principais: lista.slice(0, 3), F, linhas, colunas,
  };
}

const fluxoTexto = f => `${f.origem} → ${f.destino}: ${n0(f.votos).toLocaleString("pt-BR")}`;

(async () => {
  // 1. Aptos, comparecimento, brancos e nulos por seção
  const zipDetalhe = baixar(ARQUIVOS.detalhe);
  console.log("Lendo aptos e comparecimento por seção...");
  const base = new Map(); // chave -> { uf, municipio, nome, t1, t2 }
  await lerZip(zipDetalhe, "detalhe_votacao_secao_2026_BR.csv", (v, c) => {
    if (v[c.CD_CARGO] !== "1" || !aceitaUf(v[c.SG_UF])) return;
    const k = chave(v[c.SG_UF], v[c.CD_MUNICIPIO], v[c.NR_ZONA], v[c.NR_SECAO]);
    let s = base.get(k);
    if (!s) base.set(k, (s = { uf: v[c.SG_UF], municipio: Number(v[c.CD_MUNICIPIO]), nome: v[c.NM_MUNICIPIO] }));
    s["t" + v[c.NR_TURNO]] = {
      aptos: Number(v[c.QT_APTOS]), comparecimento: Number(v[c.QT_COMPARECIMENTO]),
      brancoNulo: Number(v[c.QT_VOTOS_BRANCOS]) + Number(v[c.QT_VOTOS_NULOS]),
      votos: {},
    };
  });

  // 2. Votos nominais por seção
  const zipVotos = baixar(ARQUIVOS.votos);
  console.log("Lendo votos por seção...");
  await lerZip(zipVotos, "votacao_secao_2026_BR.csv", (v, c) => {
    if (v[c.CD_CARGO] !== "1" || !aceitaUf(v[c.SG_UF])) return;
    const n = v[c.NR_VOTAVEL];
    if (n === "95" || n === "96") return;
    const s = base.get(chave(v[c.SG_UF], v[c.CD_MUNICIPIO], v[c.NR_ZONA], v[c.NR_SECAO]));
    const t = s && s["t" + v[c.NR_TURNO]];
    if (t) t.votos[n] = (t.votos[n] || 0) + Number(v[c.QT_VOTOS]);
  });

  // 3. Vetores de cada seção presente nos dois turnos
  const secoes = [];
  for (const s of base.values()) {
    if (!s.t1 || !s.t2 || !s.t1.aptos || !s.t2.aptos) continue;
    const x = Array(NO).fill(0);
    for (const [n, q] of Object.entries(s.t1.votos)) x[idxOrigem[n] ?? IDX_OUTROS] += q;
    x[NO - 2] = s.t1.brancoNulo;
    x[NO - 1] = s.t1.aptos - s.t1.comparecimento;
    const y = Array(ND).fill(0);
    for (const [n, q] of Object.entries(s.t2.votos)) if (n in idxDestino) y[idxDestino[n]] += q;
    y[ND - 2] = s.t2.brancoNulo;
    y[ND - 1] = s.t2.aptos - s.t2.comparecimento;
    secoes.push({ uf: s.uf, municipio: s.municipio, nome: s.nome, a1: s.t1.aptos, a2: s.t2.aptos, x, y });
  }
  console.log(`${secoes.length.toLocaleString("pt-BR")} seções com dados nos dois turnos.`);

  // 4. Coordenadas aproximadas de cada município (média dos locais de votação, pesada pelos eleitores)
  const zipLocais = baixar(ARQUIVOS.locais);
  console.log("Lendo coordenadas dos locais de votação...");
  const coords = new Map();
  await lerZip(zipLocais, "eleitorado_local_votacao_2026_BRASIL.csv", (v, c) => {
    if (v[c.NR_TURNO] !== "2" || !aceitaUf(v[c.SG_UF])) return;
    const lat = Number(v[c.NR_LATITUDE].replace(",", ".")), lon = Number(v[c.NR_LONGITUDE].replace(",", "."));
    if (!lat || !lon || lat === -1 || lon === -1) return;
    const k = `${v[c.SG_UF]}|${Number(v[c.CD_MUNICIPIO])}`, w = Number(v[c.QT_ELEITOR_SECAO]) || 1;
    const m = coords.get(k) || { lat: 0, lon: 0, w: 0 };
    m.lat += lat * w; m.lon += lon * w; m.w += w;
    coords.set(k, m);
  });

  // 5. Estimativa por estado e por município
  const porUf = d => d.reduce((m, s) => (m.has(s.uf) ? m.get(s.uf).push(s) : m.set(s.uf, [s]), m), new Map());
  const estados = [], municipios = [];
  for (const [uf, lista] of [...porUf(secoes)].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { G, C } = acumular(lista);
    const B = estimarMatriz(G, C);
    const est = { uf, B, secoes: lista.length, erro: erroMedio(lista, B), ...resumir(fluxos(lista, B)) };
    estados.push(est);

    // λ equivalente a ~10 seções típicas do estado
    let traco = 0;
    for (let i = 0; i < NO; i++) traco += G[i][i];
    const lambda = (10 * traco) / lista.length / NO;
    const porMun = lista.reduce((m, s) => (m.has(s.municipio) ? m.get(s.municipio).push(s) : m.set(s.municipio, [s]), m), new Map());
    for (const [cod, ss] of porMun) {
      const a = acumular(ss);
      const Bm = estimarMatriz(a.G, a.C, lambda, B);
      const c = coords.get(`${uf}|${cod}`);
      municipios.push({
        uf, codigo: cod, nome: nomeProprio(ss[0].nome), secoes: ss.length,
        aptos: ss.reduce((t, s) => t + s.a2, 0),
        latitude: c ? +(c.lat / c.w).toFixed(5) : null, longitude: c ? +(c.lon / c.w).toFixed(5) : null,
        ...resumir(fluxos(ss, Bm)),
      });
    }
    console.log(`  ${uf}: ${lista.length} seções, ${porMun.size} municípios, erro médio ${est.erro.toFixed(2)} p.p.`);
  }

  // 6. Brasil: soma dos fluxos dos estados
  const Fbr = zeros(NO, ND);
  for (const e of estados) e.F.forEach((r, i) => r.forEach((v, k) => (Fbr[i][k] += v)));
  const somar = campo => estados.reduce((t, e) => t.map((v, i) => v + e[campo][i]), Array(campo === "linhas" ? NO : ND).fill(0));
  const brasil = resumir({ F: Fbr, linhas: somar("linhas"), colunas: somar("colunas") });

  // ---------- Arquivos ----------

  // Matriz de fluxos por estado (e Brasil): uma linha por origem x destino
  const linhasFluxo = [];
  for (const e of [{ uf: "BR", ...brasil }, ...estados]) {
    for (let i = 0; i < NO; i++) {
      const total = e.F[i].reduce((a, b) => a + b, 0);
      for (let k = 0; k < ND; k++) {
        linhasFluxo.push([e.uf, csvTexto(ORIGENS[i].nome), csvTexto(DESTINOS[k].nome), n0(e.F[i][k]), pct(total ? e.F[i][k] / total : 0)]);
      }
    }
  }
  salvarCsv("migracao-presidente-fluxos-estados.csv",
    ["UF", "Origem (1º turno)", "Destino (2º turno)", "Votos estimados", "% da origem"], linhasFluxo);

  // Resumo por estado
  const cabResumo = ["UF", "Lula 1T", "Flávio 1T", "Lula 2T", "Flávio 2T", "Ganho Lula", "Ganho Flávio",
    "Margem Lula 1T (%)", "Margem Lula 2T (%)", "Variação da margem (p.p.)", "Vencedor 1T", "Vencedor 2T", "Virada",
    ...ORIGENS.slice(2).flatMap(o => [`${o.nome} → Lula (%)`, `${o.nome} → Flávio (%)`]),
    "Votos em movimento", "Principais fluxos", "Seções", "Erro médio do modelo (p.p.)"];
  const linhaResumo = e => {
    const parte = i => {
      const total = e.F[i].reduce((a, b) => a + b, 0);
      return [pct(total ? e.F[i][0] / total : 0), pct(total ? e.F[i][1] / total : 0)];
    };
    return [e.uf, n0(e.lula1), n0(e.flavio1), n0(e.lula2), n0(e.flavio2), n0(e.deltaLula), n0(e.deltaFlavio),
      pct(e.margem1), pct(e.margem2), pct(e.variacaoMargem), csvTexto(e.vencedor1), csvTexto(e.vencedor2),
      e.virada ? "Sim" : "Não", ...ORIGENS.slice(2).flatMap((_, j) => parte(j + 2)), n0(e.movimento),
      csvTexto(e.principais.map(fluxoTexto).join(" | ")), e.secoes ?? "", e.erro == null ? "" : dec(e.erro.toFixed(2))];
  };
  salvarCsv("migracao-presidente-estados.csv", cabResumo, [{ uf: "BR", ...brasil }, ...estados].map(linhaResumo));

  // Top municípios por estado, em dois rankings
  const cabMun = ["UF", "Ranking", "Posição", "Município", "Código TSE", "Latitude", "Longitude", "Aptos",
    "Lula 1T", "Flávio 1T", "Lula 2T", "Flávio 2T", "Ganho Lula", "Ganho Flávio",
    "Margem Lula 1T (%)", "Margem Lula 2T (%)", "Variação da margem (p.p.)", "Vencedor 1T", "Vencedor 2T", "Virada",
    "Votos em movimento", "Fluxo 1", "Fluxo 2", "Fluxo 3"];
  const linhasMun = [], topJson = [];
  const rankings = [
    { nome: "Volume de votos em movimento", ordem: (a, b) => b.movimento - a.movimento, filtro: () => true },
    // Municípios com ao menos 10 mil aptos, para não dar destaque a variações de cidades muito pequenas
    { nome: "Maior variação da margem", ordem: (a, b) => Math.abs(b.variacaoMargem) - Math.abs(a.variacaoMargem), filtro: m => m.aptos >= 10000 },
  ];
  for (const e of estados) {
    const doUf = municipios.filter(m => m.uf === e.uf);
    for (const r of rankings) {
      doUf.filter(r.filtro).sort(r.ordem).slice(0, TOP).forEach((m, i) => {
        linhasMun.push([m.uf, csvTexto(r.nome), i + 1, csvTexto(m.nome), m.codigo, dec(m.latitude), dec(m.longitude), m.aptos,
          n0(m.lula1), n0(m.flavio1), n0(m.lula2), n0(m.flavio2), n0(m.deltaLula), n0(m.deltaFlavio),
          pct(m.margem1), pct(m.margem2), pct(m.variacaoMargem), csvTexto(m.vencedor1), csvTexto(m.vencedor2),
          m.virada ? "Sim" : "Não", n0(m.movimento), ...[0, 1, 2].map(j => csvTexto(m.principais[j] ? fluxoTexto(m.principais[j]) : ""))]);
        topJson.push({ ranking: r.nome, posicao: i + 1, ...m, F: undefined });
      });
    }
  }
  salvarCsv(`migracao-presidente-top${TOP}-municipios.csv`, cabMun, linhasMun);

  // Todos os municípios em que o vencedor mudou entre os turnos
  const viradas = municipios.filter(m => m.virada).sort((a, b) => a.uf.localeCompare(b.uf) || b.aptos - a.aptos);
  salvarCsv("migracao-presidente-viradas.csv", cabMun.filter(c => c !== "Ranking" && c !== "Posição"),
    viradas.map(m => [m.uf, csvTexto(m.nome), m.codigo, dec(m.latitude), dec(m.longitude), m.aptos,
      n0(m.lula1), n0(m.flavio1), n0(m.lula2), n0(m.flavio2), n0(m.deltaLula), n0(m.deltaFlavio),
      pct(m.margem1), pct(m.margem2), pct(m.variacaoMargem), csvTexto(m.vencedor1), csvTexto(m.vencedor2), "Sim",
      n0(m.movimento), ...[0, 1, 2].map(j => csvTexto(m.principais[j] ? fluxoTexto(m.principais[j]) : ""))]));

  // JSON com tudo, para gráficos e para o roteiro
  const matriz = F => F.map((r, i) => Object.fromEntries([["origem", ORIGENS[i].nome], ...r.map((v, k) => [DESTINOS[k].nome, n0(v)])]));
  const semF = ({ F, B, linhas, colunas, ...resto }) => resto;
  fs.writeFileSync(path.join(saida, "migracao-presidente.json"), JSON.stringify({
    metodo: "Inferência ecológica por seção eleitoral (mínimos quadrados com restrições), ajustada aos totais reais (IPF).",
    brasil: { ...semF(brasil), fluxos: matriz(brasil.F) },
    estados: estados.map(e => ({ ...semF(e), fluxos: matriz(e.F) })),
    topMunicipios: topJson.map(semF),
    viradas: viradas.length,
  }, null, 1));
  console.log("JSON salvo em", path.join(saida, "migracao-presidente.json"));

  // Terminal
  console.log(`\nBrasil - de onde vieram os votos do 2º turno (estimativa):`);
  console.table(ORIGENS.map((o, i) => ({
    "1º turno": o.nome, Votos: n0(brasil.F[i].reduce((a, b) => a + b, 0)).toLocaleString("pt-BR"),
    ...Object.fromEntries(DESTINOS.map((d, k) => [d.nome, pct(brasil.F[i][k] / brasil.F[i].reduce((a, b) => a + b, 0)) + "%"])),
  })));
  console.log(`${viradas.length} municípios mudaram de vencedor entre os turnos.`);
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
