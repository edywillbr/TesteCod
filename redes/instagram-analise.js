// Analisa as coletas de redes/dados/instagram-coletas.jsonl e aponta publicações e saltos fora do padrão.
// Uso: node redes/instagram-analise.js [--fator 3]
//
// Sinais calculados (indícios, não provas: impulsionamento pago e mobilização organizada também os produzem):
//   - Engajamento de cada publicação ((curtidas + comentários) / seguidores) comparado com a mediana do próprio
//     perfil; "fora do padrão" quando passa de --fator vezes a mediana.
//   - Proporção comentários/curtidas comparada com a mediana do perfil (comentários em massa ou curtidas sem conversa).
//   - Com várias coletas: saltos de curtidas numa hora muito acima do ritmo da própria publicação depois das
//     primeiras 24 horas (quando o crescimento orgânico costuma desacelerar), crescimento de madrugada
//     (0h às 6h, horário de Brasília) e saltos de seguidores.

const fs = require("fs");
const path = require("path");

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const FATOR = Number(argumento("--fator", "3"));
const DADOS = path.join(__dirname, "dados");
const coletas = fs.readFileSync(path.join(DADOS, "instagram-coletas.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));

const mediana = v => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const horaBrasilia = iso => (new Date(iso).getUTCHours() + 21) % 24;
const csvTexto = v => `"${String(v ?? "").replace(/"/g, '""').replace(/\s+/g, " ")}"`;
const dec = (v, casas = 2) => (Number.isFinite(v) ? v.toFixed(casas).replace(".", ",") : "");

function salvarCsv(nome, cabecalho, linhas) {
  const arquivo = path.join(DADOS, nome);
  fs.writeFileSync(arquivo, "﻿" + [cabecalho.join(";"), ...linhas.map(l => l.join(";"))].join("\r\n") + "\r\n");
  console.log("CSV salvo em", arquivo);
}

const porPerfil = new Map();
for (const c of coletas) {
  if (!porPerfil.has(c.perfil)) porPerfil.set(c.perfil, []);
  porPerfil.get(c.perfil).push(c);
}

const linhasPub = [], alertas = [], resumo = [];
for (const [perfil, lista] of porPerfil) {
  lista.sort((a, b) => a.coletadoEm.localeCompare(b.coletadoEm));
  const ultima = lista[lista.length - 1];

  // 1. Publicações na coleta mais recente, comparadas com o padrão do perfil
  const pubs = ultima.midias.filter(m => m.curtidas !== null).map(m => ({
    ...m,
    engajamento: (m.curtidas + m.comentarios) / ultima.seguidores,
    comentariosPorCurtida: m.curtidas ? m.comentarios / m.curtidas : null,
  }));
  const medEng = mediana(pubs.map(p => p.engajamento));
  const medCom = mediana(pubs.map(p => p.comentariosPorCurtida));
  for (const p of pubs) {
    const vezesEng = medEng ? p.engajamento / medEng : null;
    const vezesCom = medCom && p.comentariosPorCurtida !== null ? p.comentariosPorCurtida / medCom : null;
    const sinais = [];
    if (vezesEng >= FATOR) sinais.push(`engajamento ${dec(vezesEng, 1)}x a mediana do perfil`);
    if (vezesCom >= FATOR) sinais.push(`comentários por curtida ${dec(vezesCom, 1)}x a mediana`);
    if (vezesCom !== null && vezesCom <= 1 / FATOR) sinais.push(`comentários por curtida ${dec(vezesCom, 2)}x a mediana`);
    linhasPub.push([csvTexto(ultima.nome), perfil, ultima.espectro, p.data, p.tipo, p.curtidas, p.comentarios,
      dec(100 * p.engajamento, 3), dec(vezesEng, 2), dec(vezesCom, 2), csvTexto(sinais.join(" | ")), p.link, csvTexto(p.legenda)]);
    if (sinais.length) alertas.push([csvTexto(ultima.nome), perfil, "Publicação fora do padrão", p.data, csvTexto(sinais.join(" | ")), p.link]);
  }

  // 2. Curvas de cada publicação entre coletas
  const serie = new Map(); // id -> [{t, curtidas, comentarios, data, link}]
  for (const c of lista) for (const m of c.midias) {
    if (m.curtidas === null) continue;
    if (!serie.has(m.id)) serie.set(m.id, []);
    serie.get(m.id).push({ t: c.coletadoEm, curtidas: m.curtidas, comentarios: m.comentarios, data: m.data, link: m.link });
  }
  let saltos = 0, madrugada = 0, totalDepois24h = 0;
  for (const pontos of serie.values()) {
    const incrementos = [];
    for (let i = 1; i < pontos.length; i++) {
      const horas = (new Date(pontos[i].t) - new Date(pontos[i - 1].t)) / 36e5;
      const idade = (new Date(pontos[i].t) - new Date(pontos[i].data)) / 36e5;
      if (horas <= 0 || horas > 3) continue; // só coletas próximas
      incrementos.push({ porHora: (pontos[i].curtidas - pontos[i - 1].curtidas) / horas, idade, t: pontos[i].t, total: pontos[i].curtidas });
    }
    const depois24h = incrementos.filter(x => x.idade > 24);
    const med = mediana(depois24h.map(x => Math.max(0, x.porHora)));
    for (const x of depois24h) {
      totalDepois24h += Math.max(0, x.porHora);
      if (horaBrasilia(x.t) < 6) madrugada += Math.max(0, x.porHora);
      if (med !== null && x.porHora > Math.max(5 * med, 0.01 * x.total) && x.porHora > 100) {
        saltos++;
        alertas.push([csvTexto(ultima.nome), perfil, "Salto de curtidas após 24h", x.t,
          csvTexto(`+${Math.round(x.porHora)} curtidas/hora, ritmo típico ${Math.round(med)}/hora, publicação com ${Math.round(x.idade)}h`), pontos[0].link]);
      }
    }
  }

  // 3. Seguidores entre coletas
  const deltas = [];
  for (let i = 1; i < lista.length; i++) {
    const horas = (new Date(lista[i].coletadoEm) - new Date(lista[i - 1].coletadoEm)) / 36e5;
    if (horas > 0 && horas <= 3) deltas.push({ porHora: (lista[i].seguidores - lista[i - 1].seguidores) / horas, t: lista[i].coletadoEm });
  }
  const medSeg = mediana(deltas.map(d => Math.abs(d.porHora)));
  for (const d of deltas) {
    if (medSeg !== null && Math.abs(d.porHora) > Math.max(5 * medSeg, 200)) {
      alertas.push([csvTexto(ultima.nome), perfil, "Salto de seguidores", d.t, csvTexto(`${d.porHora > 0 ? "+" : ""}${Math.round(d.porHora)} seguidores/hora, típico ${Math.round(medSeg)}/hora`), ""]);
    }
  }

  resumo.push([csvTexto(ultima.nome), perfil, ultima.espectro, ultima.coletadoEm, lista.length, ultima.seguidores,
    pubs.length, dec(100 * medEng, 3), dec(medCom, 4), pubs.filter(p => medEng && p.engajamento / medEng >= FATOR).length,
    saltos, dec(totalDepois24h ? (100 * madrugada) / totalDepois24h : NaN, 1)]);
}

salvarCsv("instagram-resumo.csv",
  ["Nome", "Perfil", "Espectro", "Última coleta", "Coletas", "Seguidores", "Publicações analisadas",
    "Engajamento mediano (%)", "Comentários por curtida (mediana)", `Publicações acima de ${FATOR}x a mediana`,
    "Saltos de curtidas após 24h", "Curtidas de madrugada após 24h (%)"], resumo);
salvarCsv("instagram-publicacoes.csv",
  ["Nome", "Perfil", "Espectro", "Data", "Tipo", "Curtidas", "Comentários", "Engajamento (%)",
    "Engajamento / mediana do perfil", "Comentários por curtida / mediana", "Sinais", "Link", "Legenda"], linhasPub);
salvarCsv("instagram-alertas.csv", ["Nome", "Perfil", "Sinal", "Quando", "Detalhe", "Link"], alertas);
console.table(resumo.map(r => ({ Perfil: r[1], Seguidores: r[5], Coletas: r[4], "Eng. mediano %": r[7], "Fora do padrão": r[9], Saltos: r[10] })));
