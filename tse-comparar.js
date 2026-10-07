// Compara dois (ou mais) candidatos ao mesmo cargo por município de um estado em 2026 e,
// opcionalmente, por zona eleitoral de um município, com a abrangência de cada zona.
// Uso: node tse-comparar.js <numero1> <numero2> [--cargo 3] [--uf am] [--zonas MANAUS] [--csv prefixo]
//   --cargo: 3 = Governador (padrão), 5 = Senador, 6 = Deputado Federal, 7 = Deputado Estadual.
//   Percentuais sobre os votos válidos do cargo, como o TSE divulga.
//   A abrangência das zonas vem de dados/bairros-zona-2026-<uf>.csv (bairros dos locais de votação,
//   extraído de eleitorado_local_votacao_2026 do Portal de Dados Abertos do TSE).

const fs = require("fs");
const path = require("path");

const ELEICAO = 6259;
const base = `https://resultados.tse.jus.br/oficial/ele2026/${ELEICAO}`;

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

// Todos os candidatos do cargo no arquivo: { numero: { nome, partido, votos, situacao } }
function candidatos(dados, codigoCargo) {
  const saida = {};
  for (const cargo of dados?.carg || []) {
    if (Number(cargo.cd) !== codigoCargo) continue;
    for (const agr of cargo.agr || []) for (const par of agr.par || []) for (const cand of par.cand || []) {
      saida[String(cand.n)] = { nome: cand.nmu, partido: par.sg, votos: Number(cand.vap || 0), situacao: cand.st };
    }
  }
  return saida;
}

const pct = (v, total) => (total ? Number((v / total * 100).toFixed(2)) : 0);
const decimal = (v, casas = 2) => (v == null ? "" : Number(v).toFixed(casas).replace(".", ","));
const campo = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

const normalizar = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

const minusculas = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);
const nomeProprio = t => String(t || "").toLowerCase().split(" ")
  .map((p, i) => (/^(i|ii|iii|iv|v|vi)$/.test(p) ? p.toUpperCase()
    : i > 0 && minusculas.has(p.toUpperCase()) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
  .join(" ");

function salvarCsv(arquivo, cabecalho, linhas) {
  fs.writeFileSync(arquivo, "﻿" + [cabecalho.join(";"), ...linhas].join("\r\n") + "\r\n");
  console.log("CSV salvo em", arquivo);
}

// Linha de comparação para uma unidade (município ou zona)
function comparar(dados, codigoCargo, numeros) {
  const cands = candidatos(dados, codigoCargo);
  const validos = Number(dados.v?.vv || 0) || Object.values(cands).reduce((s, c) => s + c.votos, 0);
  const lider = Object.entries(cands).sort((a, b) => b[1].votos - a[1].votos)[0];
  const linha = { aptos: Number(dados.e?.te || 0), validos };
  for (const n of numeros) {
    linha[`votos_${n}`] = cands[n]?.votos ?? 0;
    linha[`pct_${n}`] = pct(cands[n]?.votos ?? 0, validos);
  }
  const [a, b] = numeros;
  linha.diferenca = linha[`votos_${a}`] - linha[`votos_${b}`];
  linha.vencedor_entre_os_dois = linha.diferenca > 0 ? a : linha.diferenca < 0 ? b : "empate";
  linha.primeiro_colocado = lider ? `${lider[1].nome}/${lider[1].partido}` : "";
  return linha;
}

(async () => {
  const numeros = process.argv.slice(2).filter((a, i, args) => /^\d+$/.test(a) && !String(args[i - 1]).startsWith("--"));
  const uf = String(argumento("--uf", "am")).toLowerCase();
  const codigoCargo = Number(argumento("--cargo", "3"));
  const prefixo = argumento("--csv", null);
  if (numeros.length < 2) {
    console.error("Uso: node tse-comparar.js <numero1> <numero2> [--cargo 3] [--uf am] [--zonas MANAUS] [--csv prefixo]");
    process.exit(1);
  }
  const c = String(codigoCargo).padStart(4, "0");

  const config = await buscarJson(`${base}/config/mun-e00${ELEICAO}-cm.json`);
  const estado = config.abr.find(a => a.cd.toLowerCase() === uf);
  if (!estado) {
    console.error(`UF "${uf}" não encontrada.`);
    process.exit(1);
  }

  const totalEstado = await buscarJson(`${base}/dados/${uf}/${uf}-c${c}-e00${ELEICAO}-u.json`);
  const candsEstado = candidatos(totalEstado, codigoCargo);
  const rotulo = n => (candsEstado[n] ? `${candsEstado[n].nome}/${candsEstado[n].partido}` : n);
  for (const n of numeros) {
    if (!candsEstado[n]) {
      console.error(`Candidato ${n} não encontrado para o cargo ${codigoCargo} em ${uf.toUpperCase()}.`);
      process.exit(1);
    }
  }
  const [a, b] = numeros;
  const nomeCurto = n => nomeProprio(candsEstado[n].nome);

  console.log(`${totalEstado.carg[0]?.nmn || `Cargo ${codigoCargo}`} — ${estado.ds} — 1º turno 2026` +
    (totalEstado.s?.pst !== "100,00" ? ` (${totalEstado.s?.pst}% das seções totalizadas)` : ""));
  const linhaEstado = comparar(totalEstado, codigoCargo, numeros);
  for (const n of numeros) {
    console.log(`  ${n} ${rotulo(n)}: ${candsEstado[n].votos} votos (${decimal(linhaEstado[`pct_${n}`])}% dos válidos) — ${candsEstado[n].situacao}`);
  }

  // por município
  const lidos = await emParalelo(estado.mu, 6, async mu => {
    const dados = await buscarJson(`${base}/dados/${uf}/${uf}${mu.cd}-c${c}-e00${ELEICAO}-u.json`);
    if (!dados) {
      console.warn(`Erro no município ${mu.nm}`);
      return null;
    }
    return { municipio: mu.nm, ...comparar(dados, codigoCargo, numeros) };
  });
  const municipios = lidos.filter(Boolean).sort((x, y) => y.aptos - x.aptos);
  const vitorias = n => municipios.filter(m => m.vencedor_entre_os_dois === n).length;

  console.log("\nPOR MUNICÍPIO");
  console.table(municipios);
  for (const n of numeros) {
    const soma = municipios.reduce((s, m) => s + m[`votos_${n}`], 0);
    console.log(`  ${rotulo(n)}: ${soma} votos (estado: ${candsEstado[n].votos}${soma === candsEstado[n].votos ? ", confere" : ", DIFERENTE"})`);
  }
  console.log(`  Municípios em que ${nomeCurto(a)} teve mais votos que ${nomeCurto(b)}: ${vitorias(a)}; o contrário: ${vitorias(b)}`);

  const cabecalhoBase = (unidade) => [unidade, "Eleitores aptos", "Votos válidos",
    ...numeros.flatMap(n => [`Votos ${nomeCurto(n)} (${n})`, `% válidos ${nomeCurto(n)}`]),
    `Diferença (${nomeCurto(a)} − ${nomeCurto(b)})`, "Mais votado entre os dois", "1º colocado na unidade"];
  const linhaCsv = (u, l) => [u, l.aptos, l.validos,
    ...numeros.flatMap(n => [l[`votos_${n}`], decimal(l[`pct_${n}`])]),
    l.diferenca, campo(l.vencedor_entre_os_dois === "empate" ? "Empate" : nomeCurto(l.vencedor_entre_os_dois)),
    campo(l.primeiro_colocado)];

  if (prefixo) {
    salvarCsv(`${prefixo}-municipios.csv`, cabecalhoBase("Município"), [
      ...municipios.map(m => linhaCsv(campo(m.municipio), m).join(";")),
      linhaCsv("TOTAL DO ESTADO", linhaEstado).join(";"),
    ]);
  }

  // por zona de um município
  const nomeZonas = argumento("--zonas", null);
  if (nomeZonas) {
    const alvo = normalizar(nomeZonas);
    const mu = estado.mu.find(m => normalizar(m.nm) === alvo || Number(m.cd) === Number(nomeZonas));
    if (!mu) {
      console.error(`Município "${nomeZonas}" não encontrado em ${uf.toUpperCase()}.`);
      process.exit(1);
    }
    const bairros = lerCsvLocal(`bairros-zona-2026-${uf}.csv`).filter(r => Number(r.municipio) === Number(mu.cd));
    const abrangencia = zona => bairros
      .filter(r => Number(r.zona) === zona)
      .sort((x, y) => Number(y.eleitores) - Number(x.eleitores))
      .map(r => nomeProprio(r.bairro))
      .join(", ");

    const zonas = (await emParalelo(mu.z, 6, async z => {
      const dados = await buscarJson(`${base}/dados/${uf}/${uf}${mu.cd}-z${z}-c${c}-e00${ELEICAO}-u.json`);
      if (!dados) {
        console.warn(`Erro na zona ${Number(z)}`);
        return null;
      }
      return { zona: Number(z), ...comparar(dados, codigoCargo, numeros), abrangencia: abrangencia(Number(z)) };
    })).filter(Boolean).sort((x, y) => y.diferenca - x.diferenca);

    const linhaMun = municipios.find(m => m.municipio === mu.nm);
    console.log(`\nPOR ZONA ELEITORAL — ${mu.nm} (${zonas.length} zonas)`);
    console.table(zonas.map(({ abrangencia: ab, ...z }) => ({ ...z, abrangencia: ab.slice(0, 50) })));
    for (const n of numeros) {
      const soma = zonas.reduce((s, z) => s + z[`votos_${n}`], 0);
      console.log(`  ${rotulo(n)}: ${soma} votos (município: ${linhaMun?.[`votos_${n}`]}${soma === linhaMun?.[`votos_${n}`] ? ", confere" : ", DIFERENTE"})`);
    }

    if (prefixo) {
      const arq = `${prefixo}-zonas-${normalizar(mu.nm).toLowerCase().replace(/ /g, "-")}.csv`;
      salvarCsv(arq, ["Zona", ...cabecalhoBase("").slice(1), "Abrangência (bairros)"], [
        ...zonas.map(z => [...linhaCsv(z.zona, z), campo(z.abrangencia)].join(";")),
        [...linhaCsv(`TOTAL ${mu.nm}`, linhaMun), ""].join(";"),
      ]);
    }
  }
})();
