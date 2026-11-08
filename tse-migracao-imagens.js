// Imagens verticais (1080x1920) para vídeo, a partir dos resultados de tse-migracao-presidente.js.
// Uso: node tse-migracao-imagens.js [--pasta migracao-presidente-2026] [--so 01,05,estado-SP]
//
// Gera cada imagem em duas versões: <pasta>/imagens com fundo transparente, para sobrepor ao vídeo
// (títulos e notas em caixas pretas), e <pasta>/imagens-com-fundo com fundo escuro.
//
// Lê migracao-presidente.json, migracao-presidente-municipios.csv e migracao-presidente-viradas.csv da pasta
// e dados/ufs-brasil.json (contornos simplificados das UFs, de codeforamerica/click_that_hood).
// Renderiza HTML com o Chromium do Playwright.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const pasta = path.resolve(argumento("--pasta", "migracao-presidente-2026"));
const so = argumento("--so", "") ? argumento("--so").split(",") : null;
const VERSOES = [
  { pasta: path.join(pasta, "imagens"), transparente: true },
  { pasta: path.join(pasta, "imagens-com-fundo"), transparente: false },
];
for (const v of VERSOES) fs.mkdirSync(v.pasta, { recursive: true });

const dados = JSON.parse(fs.readFileSync(path.join(pasta, "migracao-presidente.json"), "utf8"));
const ufs = JSON.parse(fs.readFileSync(path.join(__dirname, "dados", "ufs-brasil.json"), "utf8"));
const nomeUf = Object.fromEntries(ufs.map(u => [u.uf, u.nome]));

function lerCsv(nome) {
  const [cab, ...linhas] = fs.readFileSync(path.join(pasta, nome), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const colunas = cab.split(";");
  return linhas.map(l => {
    const v = l.split(";").map(x => x.replace(/^"|"$/g, "").replace(/""/g, '"'));
    return Object.fromEntries(colunas.map((c, i) => [c, v[i]]));
  });
}
const num = v => Number(String(v).replace(",", "."));
const municipios = lerCsv("migracao-presidente-municipios.csv");
const viradas = lerCsv("migracao-presidente-viradas.csv");

// ---------- Formatos e cores ----------

const COR = { flavio: "#2a5bd7", lula: "#d7263d", terceira: "#f2c230", novos: "#ffffff", nulos: "#8b919c" };
const mi = v => (v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mi";
const mil = v => {
  const a = Math.abs(v);
  if (a >= 1e6) return mi(v);
  if (a >= 1e3) return Math.round(v / 1e3).toLocaleString("pt-BR") + " mil";
  return Math.round(v).toLocaleString("pt-BR");
};
const int = v => Math.round(v).toLocaleString("pt-BR");
const sinal = (v, f = mil) => (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v));
const pp = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(100 * v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " p.p.";
const pc = v => Math.round(100 * v) + "%";
const esc = t => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FONTE_TSE = "Fonte: TSE, votação e comparecimento por seção eleitoral, 1º e 2º turnos de 2026.";
const FONTE_EST = "Estimativa por seção eleitoral (inferência ecológica), ajustada aos totais do TSE. Não é o voto de cada eleitor.";

// ---------- Página base ----------

let transparente = false;

function pagina(corpo, { fonte = FONTE_TSE, nota = "" } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1080px; height: 1920px; background: #101216; color: #f4f5f7; font-family: Inter, sans-serif;
    display: flex; flex-direction: column; padding: 120px 64px 96px; gap: 40px; font-variant-numeric: tabular-nums; }
  .eyebrow { font-size: 30px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #9aa1ad; }
  h1 { font-family: "Inter Display", Inter, sans-serif; font-size: 72px; line-height: 1.05; font-weight: 800; text-wrap: balance; }
  .sub { font-size: 36px; line-height: 1.3; color: #c9cdd4; }
  .card { background: #fff; color: #16181d; border-radius: 28px; padding: 44px 44px; display: flex; flex-direction: column; gap: 28px; }
  .card h2 { font-size: 34px; font-weight: 700; color: #16181d; }
  .card .nota { font-size: 26px; color: #5b616c; line-height: 1.35; }
  .preto { background: #000; border-radius: 28px; padding: 36px 44px; font-size: 40px; line-height: 1.3; }
  .preto b { color: #ffd23f; }
  .rodape { margin-top: auto; font-size: 22px; color: #7c838f; line-height: 1.4; }
  body.transparente { background: transparent; }
  body.transparente .eyebrow { align-self: flex-start; background: #000; color: #d6d9de; padding: 10px 18px; border-radius: 14px; }
  body.transparente h1 { background: #000; padding: 24px 32px; border-radius: 28px; }
  body.transparente .rodape { background: rgba(0, 0, 0, .8); color: #c9cdd4; padding: 14px 20px; border-radius: 14px; }
  .legenda { display: flex; flex-wrap: wrap; gap: 14px 32px; font-size: 26px; color: #2b2f36; }
  .legenda span { display: inline-flex; align-items: center; gap: 10px; }
  .sw { width: 22px; height: 22px; border-radius: 4px; display: inline-block; border: 1px solid #c7cbd1; }
  .grande { font-family: "Inter Display", Inter, sans-serif; font-size: 150px; font-weight: 800; line-height: 1; }
  table { border-collapse: collapse; width: 100%; font-size: 28px; }
  td { padding: 14px 0; border-bottom: 1px solid #e3e5e8; vertical-align: top; }
  </style></head><body class="${transparente ? "transparente" : ""}">${corpo}
  <div class="rodape">${nota ? esc(nota) + "<br>" : ""}${esc(fonte)}</div></body></html>`;
}

// Barra empilhada horizontal com rótulos acima de cada pedaço grande.
function barra(partes, { largura = 904, altura = 96, rotulos = true } = {}) {
  const total = partes.reduce((t, p) => t + p.v, 0);
  let x = 0;
  const rects = partes.map((p, i) => {
    const w = (p.v / total) * largura;
    const ultimo = i === partes.length - 1;
    const r = `<rect x="${x}" y="48" width="${Math.max(0, w - 3)}" height="${altura}" fill="${p.cor}" stroke="${p.cor === "#ffffff" ? "#c7cbd1" : "none"}"/>` +
      (rotulos && w > 110 ? `<text x="${ultimo ? x + w - 6 : x + 8}" y="34" text-anchor="${ultimo ? "end" : "start"}" font-size="26" font-weight="700" fill="#16181d">${esc(p.rotulo ?? "")}</text>` : "");
    x += w;
    return r;
  }).join("");
  return `<svg width="${largura}" height="${altura + 56}" viewBox="0 0 ${largura} ${altura + 56}">${rects}</svg>`;
}

function legenda(itens) {
  return `<div class="legenda">${itens.map(([cor, txt]) => `<span><i class="sw" style="background:${cor}"></i>${esc(txt)}</span>`).join("")}</div>`;
}

// ---------- Mapa (Mercator feito à mão) ----------

function projecao(feicoes, largura, altura, margem = 10) {
  const merc = ([lon, lat]) => [lon * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
  const pts = feicoes.flatMap(f => f.geometry.coordinates.flat(2)).map(merc);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((largura - 2 * margem) / (x1 - x0), (altura - 2 * margem) / (y1 - y0));
  const ox = (largura - k * (x1 - x0)) / 2, oy = (altura - k * (y1 - y0)) / 2;
  const proj = c => { const [x, y] = merc(c); return [ox + (x - x0) * k, oy + (y1 - y) * k]; };
  const caminho = f => f.geometry.coordinates.map(poly => poly.map(r =>
    "M" + r.map(c => proj(c).map(v => v.toFixed(1)).join(",")).join("L") + "Z").join("")).join("");
  return { proj, caminho, altura: Math.ceil(oy * 2 + k * (y1 - y0)) };
}

function mapa(feicoes, pontos, { largura = 904, altura = 860, fundo = "#e8eaee", borda = "#ffffff" } = {}) {
  const { proj, caminho } = projecao(feicoes, largura, altura);
  const formas = feicoes.map(f => `<path d="${caminho(f)}" fill="${fundo}" stroke="${borda}" stroke-width="1.5" fill-rule="evenodd"/>`).join("");
  const marcas = pontos.map(p => {
    const [x, y] = proj([p.lon, p.lat]);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${p.r}" fill="${p.cor}" fill-opacity="${p.opacidade ?? 0.75}" stroke="#fff" stroke-width="1"/>` +
      (p.rotulo ? `<text x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" font-size="${p.r * 1.1}" font-weight="800" fill="#fff" text-anchor="middle" dominant-baseline="middle">${esc(p.rotulo)}</text>` : "");
  }).join("");
  return `<svg width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}">${formas}${marcas}</svg>`;
}

// ---------- Números do Brasil ----------

const br = dados.brasil;
const fluxo = (orig, dest) => {
  const linha = br.fluxos.find(f => f.origem === orig);
  return linha ? linha[dest] : 0;
};
const TV = ["Augusto Cury", "Renan Santos", "Ronaldo Caiado", "Outros candidatos"];
const somaFluxo = (origens, dest) => origens.reduce((t, o) => t + fluxo(o, dest), 0);
const totalOrigem = o => ["Lula", "Flávio Bolsonaro", "Branco/Nulo", "Abstenção"].reduce((t, d) => t + fluxo(o, d), 0);
const totalDestino = d => br.fluxos.reduce((t, f) => t + f[d], 0);
const tv = { lula: somaFluxo(TV, "Lula"), flavio: somaFluxo(TV, "Flávio Bolsonaro"), bn: somaFluxo(TV, "Branco/Nulo") + somaFluxo(TV, "Abstenção") };
tv.total = tv.lula + tv.flavio + tv.bn;
const nulos1 = totalOrigem("Branco/Nulo") + totalOrigem("Abstenção");
const nulos2 = totalDestino("Branco/Nulo") + totalDestino("Abstenção");
const perdaFlavio = { lula: fluxo("Flávio Bolsonaro", "Lula"), sai: fluxo("Flávio Bolsonaro", "Branco/Nulo") + fluxo("Flávio Bolsonaro", "Abstenção") };
const perdaLula = { flavio: fluxo("Lula", "Flávio Bolsonaro"), sai: fluxo("Lula", "Branco/Nulo") + fluxo("Lula", "Abstenção") };

// ---------- Imagens ----------

const imagens = {};

imagens["01-primeiro-turno"] = () => pagina(`
  <div class="eyebrow">Presidente · 1º turno de 2026</div>
  <h1>Flávio saiu na frente</h1>
  <div class="card">
    <h2>Eleitores aptos, em milhões</h2>
    ${barra([
      { v: br.flavio1, cor: COR.flavio, rotulo: mi(br.flavio1) },
      { v: br.lula1, cor: COR.lula, rotulo: mi(br.lula1) },
      { v: tv.total, cor: COR.terceira, rotulo: mi(tv.total) },
      { v: nulos1, cor: COR.nulos, rotulo: mi(nulos1) },
    ])}
    ${legenda([[COR.flavio, "Flávio"], [COR.lula, "Lula"], [COR.terceira, "Terceira via"], [COR.nulos, "Nulos, brancos e abstenções"]])}
  </div>
  <div class="preto">Terceira via: <b>${mi(tv.total)}</b><br>Cury ${mi(totalOrigem("Augusto Cury"))} · Renan ${mi(totalOrigem("Renan Santos"))} · Caiado ${mi(totalOrigem("Ronaldo Caiado"))} · outros ${mi(totalOrigem("Outros candidatos"))}</div>
  <div class="preto">Nulos, brancos e abstenções: <b>${mi(nulos1)}</b><br>Abstenção ${mi(totalOrigem("Abstenção"))} · nulos e brancos ${mi(totalOrigem("Branco/Nulo"))}</div>`);

imagens["02-segundo-turno"] = () => pagina(`
  <div class="eyebrow">Presidente · 2º turno de 2026</div>
  <h1>Lula virou a eleição</h1>
  <div class="card">
    <h2>Eleitores aptos, em milhões</h2>
    ${barra([
      { v: br.flavio2, cor: COR.flavio, rotulo: mi(br.flavio2) },
      { v: br.lula2, cor: COR.lula, rotulo: mi(br.lula2) },
      { v: nulos2, cor: COR.nulos, rotulo: mi(nulos2) },
    ])}
    ${legenda([[COR.flavio, "Flávio"], [COR.lula, "Lula"], [COR.nulos, "Nulos, brancos e abstenções"]])}
  </div>
  <div class="preto">Lula: <b>${sinal(br.deltaLula, mi)}</b><br>Flávio: <b>${sinal(br.deltaFlavio, mi)}</b><br>Nulos, brancos e abstenções: <b>${sinal(nulos2 - nulos1, mi)}</b></div>`);

// Cascata: de onde veio o saldo de cada um
// Pico da soma acumulada, para as duas cascatas usarem a mesma escala.
const picoCascata = passos => passos.reduce(([acum, pico], p) => [acum + p.v, Math.max(pico, acum + p.v)], [0, 0])[1];

function cascata(passos, total, cor, maximo) {
  const largura = 904, linha = 66, esq = 300, escala = (largura - esq - 220) / maximo;
  let acum = 0;
  const linhas = [...passos, { rotulo: "Saldo", v: total, saldo: true }].map((p, i) => {
    const y = i * linha;
    const ini = p.saldo ? 0 : p.v >= 0 ? acum : acum + p.v;
    const w = Math.abs(p.v) * escala;
    if (!p.saldo) acum += p.v;
    const fill = p.saldo ? cor : p.v >= 0 ? cor : "#9aa1ad";
    return `<text x="${esq - 16}" y="${y + 42}" font-size="27" text-anchor="end" fill="#2b2f36" font-weight="${p.saldo ? 800 : 500}">${esc(p.rotulo)}</text>
      <rect x="${esq + ini * escala}" y="${y + 14}" width="${Math.max(3, w)}" height="${linha - 26}" rx="6" fill="${fill}" fill-opacity="${p.saldo ? 1 : 0.85}"/>
      <text x="${esq + ini * escala + w + 12}" y="${y + 42}" font-size="27" font-weight="700" fill="#16181d">${Math.abs(p.v) >= 1e6 ? sinal(p.v, mi) : sinal(p.v)}</text>`;
  }).join("");
  return `<svg width="${largura}" height="${(passos.length + 1) * linha}" viewBox="0 0 ${largura} ${(passos.length + 1) * linha}">${linhas}</svg>`;
}

const passosLula = [
  { rotulo: "Terceira via", v: tv.lula },
  { rotulo: "Nulos e brancos", v: fluxo("Branco/Nulo", "Lula") },
  { rotulo: "Abstenção", v: fluxo("Abstenção", "Lula") },
  { rotulo: "Eleitores do Flávio", v: perdaFlavio.lula },
  { rotulo: "Eleitores perdidos", v: -(perdaLula.flavio + perdaLula.sai) },
];
const passosFlavio = [
  { rotulo: "Terceira via", v: tv.flavio },
  { rotulo: "Nulos e brancos", v: fluxo("Branco/Nulo", "Flávio Bolsonaro") },
  { rotulo: "Abstenção", v: fluxo("Abstenção", "Flávio Bolsonaro") },
  { rotulo: "Eleitores do Lula", v: perdaLula.flavio },
  { rotulo: "Eleitores perdidos", v: -(perdaFlavio.lula + perdaFlavio.sai) },
];
const maximoCascata = Math.max(picoCascata(passosLula), picoCascata(passosFlavio));

imagens["03-de-onde-veio-o-ganho"] = () => pagina(`
  <div class="eyebrow">Do 1º para o 2º turno · estimativa</div>
  <h1>De onde veio o saldo de cada um</h1>
  <div class="card">
    <h2>Lula: ${sinal(br.deltaLula, mi)}</h2>
    ${cascata(passosLula, br.deltaLula, COR.lula, maximoCascata)}
  </div>
  <div class="card">
    <h2>Flávio: ${sinal(br.deltaFlavio, mi)}</h2>
    ${cascata(passosFlavio, br.deltaFlavio, COR.flavio, maximoCascata)}
  </div>`, { fonte: FONTE_EST + " " + FONTE_TSE });

imagens["04-terceira-via"] = () => {
  const linhaTv = (rotulo, lula, flavio, bn) => {
    const t = lula + flavio + bn;
    return `<div style="display:flex;flex-direction:column;gap:6px"><div style="font-size:28px;font-weight:700">${esc(rotulo)}</div>
      ${barra([{ v: flavio, cor: COR.flavio, rotulo: "Flávio " + pc(flavio / t) }, { v: lula, cor: COR.lula, rotulo: "Lula " + pc(lula / t) }, { v: bn, cor: COR.nulos, rotulo: "Nulo/abst. " + pc(bn / t) }], { altura: 64 })}</div>`;
  };
  const cand = o => linhaTv(o, fluxo(o, "Lula"), fluxo(o, "Flávio Bolsonaro"), fluxo(o, "Branco/Nulo") + fluxo(o, "Abstenção"));
  return pagina(`
  <div class="eyebrow">Os ${mi(tv.total)} da terceira via · estimativa</div>
  <h1>Para onde foram</h1>
  <div class="card">
    ${linhaTv(`Terceira via, total (${mi(tv.total)})`, tv.lula, tv.flavio, tv.bn)}
  </div>
  <div class="card">
    <h2>Por candidato</h2>
    ${cand("Augusto Cury")}${cand("Renan Santos")}${cand("Ronaldo Caiado")}
  </div>`, { fonte: FONTE_EST + " " + FONTE_TSE });
};

imagens["05-flavio-perdeu-eleitores"] = () => pagina(`
  <div class="eyebrow">Contagem direta nas seções</div>
  <h1>Flávio perdeu eleitores do 1º para o 2º turno</h1>
  <div class="card">
    <div class="nota">No mínimo</div>
    <div class="grande" style="color:${COR.flavio}">${mil(br.perdaMinFlavio)}</div>
    <div style="font-size:34px;line-height:1.3">eleitores do Flávio no 1º turno não repetiram o voto</div>
    <div class="nota">Soma dos votos que ele perdeu em cada seção onde caiu: <b>${int(br.secoesFlavioCaiu)}</b> das ${int(br.secoes)} seções. É um piso: dentro de uma mesma seção ele pode ter perdido uns e ganhado outros.</div>
  </div>
  <div class="preto">Estimativa total: <b>~${mil(perdaFlavio.lula + perdaFlavio.sai)}</b><br>${mil(perdaFlavio.lula)} → Lula · ${mil(perdaFlavio.sai)} → nulo ou abstenção</div>
  <div class="preto" style="font-size:32px">Lula também perdeu: no mínimo <b>${mil(br.perdaMinLula)}</b>, em ${int(br.secoesLulaCaiu)} seções.</div>`,
  { fonte: FONTE_TSE + " A estimativa total usa inferência ecológica." });

imagens["06-mapa-flavio-caiu"] = () => {
  const caiu = municipios.filter(m => num(m["Ganho Flávio"]) < 0 && m.Latitude && m.UF !== "ZZ");
  const maior = Math.max(...caiu.map(m => -num(m["Ganho Flávio"])));
  const pts = caiu.sort((a, b) => num(a["Ganho Flávio"]) - num(b["Ganho Flávio"])).map(m => ({
    lat: num(m.Latitude), lon: num(m.Longitude), cor: COR.flavio, opacidade: 0.6,
    r: 4 + 18 * Math.sqrt(-num(m["Ganho Flávio"]) / maior),
  }));
  return pagina(`
  <div class="eyebrow">Municípios</div>
  <h1>Onde Flávio teve menos votos no 2º turno</h1>
  <div class="card" style="padding:28px">
    ${mapa(ufs, pts, { altura: 900 })}
    <div class="nota">Cada círculo é um município em que Flávio teve menos votos no 2º turno do que no 1º. O tamanho indica quantos votos ele perdeu.</div>
  </div>
  <div class="preto">Flávio perdeu votos em <b>${int(municipios.filter(m => num(m["Ganho Flávio"]) < 0).length)} municípios</b>. Lula, em ${int(municipios.filter(m => num(m["Ganho Lula"]) < 0).length)}.</div>`);
};

imagens["07-estados-flavio-perdeu"] = () => {
  const neg = dados.estados.filter(e => e.deltaFlavio < 0 && e.uf !== "ZZ").sort((a, b) => a.deltaFlavio - b.deltaFlavio);
  const maior = Math.max(...neg.map(e => -e.deltaFlavio));
  const linhas = neg.map(e => `<tr><td style="width:300px;font-weight:700">${esc(nomeUf[e.uf] || e.uf)}</td>
    <td><div style="height:44px;width:${(420 * -e.deltaFlavio) / maior}px;background:${COR.flavio};border-radius:6px;display:inline-block;vertical-align:middle"></div>
    <span style="margin-left:14px;font-weight:700">${sinal(e.deltaFlavio, int)}</span></td></tr>`).join("");
  return pagina(`
  <div class="eyebrow">Estados</div>
  <h1>Em ${neg.length} estados Flávio teve menos votos no 2º turno</h1>
  <div class="card"><h2>Votos do 2º turno menos votos do 1º turno</h2><table>${linhas}</table></div>
  <div class="preto">Nos outros estados ele cresceu, mas Lula cresceu mais em todos.</div>`);
};

imagens["08-mapa-viradas"] = () => {
  const pts = viradas.filter(m => m.Latitude && m.UF !== "ZZ").map(m => ({
    lat: num(m.Latitude), lon: num(m.Longitude), r: 7 + 14 * Math.sqrt(num(m.Aptos) / 1e6),
    cor: m["Vencedor 2T"] === "Lula" ? COR.lula : m["Vencedor 2T"] === "Flávio Bolsonaro" ? COR.flavio : COR.nulos, opacidade: 0.8,
  }));
  const paraLula = viradas.filter(m => m["Vencedor 2T"] === "Lula").length, paraFlavio = viradas.filter(m => m["Vencedor 2T"] === "Flávio Bolsonaro").length;
  return pagina(`
  <div class="eyebrow">Municípios</div>
  <h1>${viradas.length} cidades mudaram de vencedor</h1>
  <div class="card" style="padding:28px">
    ${mapa(ufs, pts, { altura: 900 })}
    ${legenda([[COR.lula, `Viraram para Lula (${paraLula})`], [COR.flavio, `Viraram para Flávio (${paraFlavio})`], [COR.nulos, "Empate em um dos turnos"]])}
  </div>
  <div class="preto">Minas Gerais foi o único <b>estado</b> que mudou de vencedor.</div>`);
};

// Um card por estado com os 10 municípios de maior volume de votos em movimento
for (const e of dados.estados.filter(e => e.uf !== "ZZ")) {
  imagens[`estado-${e.uf}`] = () => {
    const top = dados.topMunicipios.filter(m => m.uf === e.uf && m.ranking === "Volume de votos em movimento").sort((a, b) => a.posicao - b.posicao);
    const feicao = ufs.filter(u => u.uf === e.uf);
    const pts = top.filter(m => m.latitude).map(m => ({ lat: m.latitude, lon: m.longitude, r: 17, cor: "#16181d", opacidade: 0.9, rotulo: String(m.posicao) }));
    const linhas = top.map(m => `<tr><td style="width:56px;font-weight:800;padding:7px 0">${m.posicao}</td>
      <td style="padding:7px 0"><div style="font-weight:700">${esc(m.nome)}${m.virada ? ` <span style="color:${m.vencedor2 === "Lula" ? COR.lula : COR.flavio}">· virou</span>` : ""}</div>
      <div style="font-size:23px;color:#5b616c">Lula ${sinal(m.deltaLula)} · Flávio ${sinal(m.deltaFlavio)} · margem de Lula ${pp(m.variacaoMargem)}</div></td></tr>`).join("");
    return pagina(`
    <div class="eyebrow">${esc(nomeUf[e.uf] || e.uf)} · do 1º para o 2º turno</div>
    <div style="display:flex;gap:28px;align-items:stretch">
      <div class="card" style="flex:1;padding:28px;gap:10px"><div class="nota">Lula</div><div style="font-size:52px;font-weight:800;color:${COR.lula}">${sinal(e.deltaLula)}</div><div class="nota">${mi(e.lula1)} → ${mi(e.lula2)}</div></div>
      <div class="card" style="flex:1;padding:28px;gap:10px"><div class="nota">Flávio</div><div style="font-size:52px;font-weight:800;color:${COR.flavio}">${sinal(e.deltaFlavio)}</div><div class="nota">${mi(e.flavio1)} → ${mi(e.flavio2)}</div></div>
    </div>
    <div class="card" style="padding:24px 28px;gap:12px">
      ${mapa(feicao, pts, { altura: 400 })}
      <h2>Os 10 municípios com mais votos em movimento</h2>
      <table>${linhas}</table>
    </div>
    <div class="preto" style="font-size:30px;padding:24px 36px">Vencedor: ${esc(e.vencedor1)} no 1º turno, ${esc(e.vencedor2)} no 2º. Margem de Lula: ${pp(e.variacaoMargem)}</div>`,
    { nota: "Votos em movimento: eleitores que, pela estimativa, mudaram de opção entre os turnos (inclui quem passou a votar ou deixou de votar).", fonte: FONTE_TSE });
  };
}

(async () => {
  const navegador = await chromium.launch();
  const pagina_ = await navegador.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const versao of VERSOES) {
    transparente = versao.transparente;
    for (const [nome, gerar] of Object.entries(imagens)) {
      if (so && !so.some(s => nome.startsWith(s))) continue;
      await pagina_.setContent(gerar(), { waitUntil: "load" });
      await pagina_.screenshot({ path: path.join(versao.pasta, `${nome}.png`), omitBackground: transparente });
    }
    console.log("Imagens salvas em", versao.pasta);
  }
  await navegador.close();
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
