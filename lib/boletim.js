// Funções comuns para ler os boletins de urna (bu.dat) e os arquivos do site de resultados do TSE.

const fs = require("fs");
const path = require("path");

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

// Local, eleitores aptos e votos do cargo na seção.
// Tipos de voto no boletim: 1 = nominal, 2 = branco, 3 = nulo, 4 = legenda.
function lerBoletim(buf, eleicao, codigoCargo) {
  const envelope = lerDer(buf)[0].filhos;
  const id = envelope.find(n => n.construido && n.classe === 2 && n.numero === 0).filhos;
  const local = inteiro(id[1]);
  const conteudo = envelope.filter(n => !n.construido && n.numero === 4 && n.classe === 0).pop();
  const boletim = lerDer(conteudo.valor);

  let bloco = null;
  for (const no of percorrer(boletim)) {
    if (no.construido && no.classe === 0 && no.numero === 16 &&
        ehInteiro(no.filhos[0]) && inteiro(no.filhos[0]) === eleicao) {
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

async function buscar(url, tipo = "json") {
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

// Boletim de uma seção (null se a seção é agregada ou não tem boletim).
async function lerSecao({ pleito, eleicao, uf, municipio, zona, secao, codigoCargo }) {
  const z = String(zona).padStart(4, "0");
  const s = String(secao).padStart(4, "0");
  const pasta = `https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/${pleito}/dados/${uf}/${municipio}/${z}/${s}`;
  const aux = await buscar(`${pasta}/p00${pleito}-${uf}-m${municipio}-z${z}-s${s}-aux.json`);
  const hash = (aux?.hashes || []).filter(h => /totalizad/i.test(h.st)).pop();
  const arquivo = hash?.arq?.find(a => a.tp === "bu");
  if (!arquivo) return null;
  const bu = await buscar(`${pasta}/${hash.hash}/${arquivo.nm}`, "bin");
  return bu ? lerBoletim(bu, eleicao, codigoCargo) : null;
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

function lerCsvLocal(nome) {
  const texto = fs.readFileSync(path.join(__dirname, "..", "dados", nome), "utf8").trim();
  const [cabecalho, ...linhas] = texto.split(/\r?\n/);
  const colunas = cabecalho.split(";");
  return linhas.map(l => {
    const valores = l.split(";");
    return Object.fromEntries(colunas.map((c, i) => [c, valores[i]]));
  });
}

const minusculas = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);
const nomeProprio = t => String(t || "").toLowerCase().split(" ")
  .map((p, i) => (/^(i|ii|iii|iv|v|vi)$/.test(p) ? p.toUpperCase()
    : i > 0 && minusculas.has(p.toUpperCase()) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
  .join(" ");

function salvarCsv(arquivo, cabecalho, linhas) {
  fs.writeFileSync(arquivo, "﻿" + [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n");
  console.log("CSV salvo em", arquivo);
}

module.exports = { lerDer, lerBoletim, lerSecao, buscar, emParalelo, lerCsvLocal, nomeProprio, salvarCsv };
