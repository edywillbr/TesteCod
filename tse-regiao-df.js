// Votos de um candidato por região, bairro e local de votação em zonas eleitorais do DF,
// 2026 (boletins de urna de cada seção) comparado com 2022 (votação por seção).
// Uso: node tse-regiao-df.js <numero2026> --zonas 4,17 [--numero2022 33456] [--csv prefixo]
//   O cargo vem do tamanho do número: 4 dígitos = Deputado Federal, 5 dígitos = Deputado Distrital.
//   Percentuais sobre os eleitores aptos.
//
// Fontes:
//   2026 - boletins de urna no site de resultados do TSE; local → bairro em dados/locais-2026-df.csv
//          (eleitorado_local_votacao_2026, Portal de Dados Abertos do TSE).
//   2022 - dados/votos-secao-2022-df.csv e dados/secoes-2022-df.csv (votacao_secao_2022_DF e
//          detalhe_votacao_secao_2022); local → bairro em dados/locais-2022-df.csv (eleitorado_local_votacao_2022).
//   Regiões - dados/regioes-df.csv: cada zona vira uma região, e locais listados ali (zona:local) têm região própria
//          (ex.: os locais da região da Ponte Alta, dentro da zona do Gama).
//   Os anos são ligados pelo número do local de votação; o bairro e o nome usados são os de 2026.

const { lerSecao, buscar, emParalelo, lerCsvLocal, nomeProprio, salvarCsv } = require("./lib/boletim");

const PLEITO = 3220;
const ELEICAO = 6259;
const cargos = { 4: { codigo: 6, nome: "Deputado Federal" }, 5: { codigo: 8, nome: "Deputado Distrital" } };

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const pct = (v, total) => (total ? Number((v / total * 100).toFixed(2)) : 0);
const decimal = (v, casas = 2) => (v == null ? "" : Number(v).toFixed(casas).replace(".", ","));
const campo = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
const variacao = (a, b) => (b ? Number(((a / b - 1) * 100).toFixed(1)) : null);

(async () => {
  const numero = process.argv.slice(2).find((a, i, args) => /^\d+$/.test(a) && !String(args[i - 1]).startsWith("--"));
  const zonas = String(argumento("--zonas", "")).split(",").map(Number).filter(Boolean);
  const numero2022 = argumento("--numero2022", numero);
  const prefixo = argumento("--csv", null);
  const cargo = numero ? cargos[numero.length] : null;
  if (!cargo || !zonas.length || cargos[String(numero2022).length]?.codigo !== cargo?.codigo) {
    console.error("Uso: node tse-regiao-df.js <numero2026> --zonas 4,17 [--numero2022 33456] [--csv prefixo]");
    process.exit(1);
  }

  // regiões, bairros e nomes dos locais
  const regioes = lerCsvLocal("regioes-df.csv");
  const regiaoZona = new Map(regioes.filter(r => r.tipo === "zona").map(r => [Number(r.codigo), r.regiao]));
  // o número do local de votação só é único dentro da zona: chave = "zona-local"
  const chaveLocal = (zona, local) => `${Number(zona)}-${Number(local)}`;
  const regiaoLocal = new Map(regioes.filter(r => r.tipo === "local").map(r => {
    const [zona, local] = r.codigo.split(":");
    return [chaveLocal(zona, local), r.regiao];
  }));
  const local26 = new Map(lerCsvLocal("locais-2026-df.csv").map(r => [chaveLocal(r.zona, r.local), r]));
  const local22 = new Map(lerCsvLocal("locais-2022-df.csv").map(r => [chaveLocal(r.zona, r.local), r]));
  const infoLocal = (zona, local) => {
    const k = chaveLocal(zona, local);
    const r = local26.get(k) || local22.get(k);
    return {
      regiao: regiaoLocal.get(k) || regiaoZona.get(zona) || `Zona ${zona}`,
      bairro: nomeProprio(r?.bairro || "Sem bairro"),
      nome_local: r?.nome_local || `Local ${local}`,
    };
  };

  // 2026: boletins de cada seção das zonas
  const config = await buscar(`https://resultados.tse.jus.br/oficial/ele2026/arquivo-urna/${PLEITO}/config/df/df-p00${PLEITO}-cs.json`);
  const mu = config.abr[0].mu.find(m => m.cd === "97012");
  const lista = mu.zon.filter(z => zonas.includes(Number(z.cd)))
    .flatMap(z => z.sec.map(s => ({ zona: Number(z.cd), secao: Number(s.ns) })));
  console.log(`Candidato ${numero} — ${cargo.nome} — zonas ${zonas.join(", ")} — ${lista.length} seções em 2026`);

  let erros = 0;
  const lidas = await emParalelo(lista, 10, async ({ zona, secao }) => {
    const r = await lerSecao({ pleito: PLEITO, eleicao: ELEICAO, uf: "df", municipio: "97012", zona, secao, codigoCargo: cargo.codigo })
      .catch(e => { erros++; console.warn(`Zona ${zona}, seção ${secao}: erro (${e.message})`); return null; });
    return r && { zona, secao, local: r.local, aptos: r.aptos, votos: r.votos[numero] || 0 };
  });
  const secoes26 = lidas.filter(Boolean);

  // 2022: votação por seção
  const votos22 = new Map();
  for (const r of lerCsvLocal("votos-secao-2022-df.csv")) {
    if (zonas.includes(Number(r.zona)) && Number(r.cargo) === cargo.codigo && r.numero === String(numero2022)) {
      const k = `${Number(r.zona)}-${Number(r.secao)}`;
      votos22.set(k, (votos22.get(k) || 0) + Number(r.votos));
    }
  }
  const secoes22 = lerCsvLocal("secoes-2022-df.csv")
    .filter(r => zonas.includes(Number(r.zona)) && Number(r.cargo) === cargo.codigo)
    .map(r => ({ zona: Number(r.zona), secao: Number(r.secao), local: Number(r.local), aptos: Number(r.aptos),
                 votos: votos22.get(`${Number(r.zona)}-${Number(r.secao)}`) || 0 }));

  // conferência com os totais oficiais por zona
  const c = String(cargo.codigo).padStart(4, "0");
  const totais22 = lerCsvLocal("votos-2022-df.csv").filter(r => Number(r.cargo) === cargo.codigo && r.numero === String(numero2022));
  let nome26 = "";
  for (const zona of zonas) {
    const z = String(zona).padStart(4, "0");
    const dados = await buscar(`https://resultados.tse.jus.br/oficial/ele2026/${ELEICAO}/dados/df/df97012-z${z}-c${c}-e00${ELEICAO}-u.json`);
    let oficial = null;
    for (const cg of dados?.carg || []) for (const a of cg.agr || []) for (const p of a.par || [])
      for (const cd of p.cand || []) if (cd.n === numero) { oficial = Number(cd.vap); nome26 = `${cd.nmu}/${p.sg}`; }
    const s26 = secoes26.filter(s => s.zona === zona).reduce((t, s) => t + s.votos, 0);
    const s22 = secoes22.filter(s => s.zona === zona).reduce((t, s) => t + s.votos, 0);
    const o22 = Number(totais22.find(r => Number(r.zona) === zona)?.votos || 0);
    console.log(`  Zona ${zona}: 2026 ${s26} (TSE ${oficial}${s26 === oficial ? ", confere" : ", DIFERENTE"}) | ` +
      `2022 ${s22} (TSE ${o22}${s22 === o22 ? ", confere" : ", DIFERENTE"})`);
  }
  const cand22 = totais22[0];
  console.log(`2026: ${nome26} | 2022 (nº ${numero2022}): ${cand22 ? `${cand22.nome_urna}/${cand22.partido}` : "não encontrado"}`);
  if (erros) console.warn(`Atenção: ${erros} seção(ões) com erro na leitura do boletim.`);

  // agrupamentos
  function agrupar(nivel) {
    const mapa = new Map();
    const somar = (s, ano) => {
      const info = infoLocal(s.zona, s.local);
      const chave = nivel === "regiao" ? info.regiao
        : nivel === "bairro" ? `${info.regiao}|${info.bairro}` : `${info.regiao}|${info.bairro}|${s.zona}-${s.local}`;
      const g = mapa.get(chave) || { ...info, local: s.local, s26: 0, a26: 0, v26: 0, s22: 0, a22: 0, v22: 0 };
      g[`s${ano}`]++;
      g[`a${ano}`] += s.aptos;
      g[`v${ano}`] += s.votos;
      mapa.set(chave, g);
    };
    secoes26.forEach(s => somar(s, 26));
    secoes22.forEach(s => somar(s, 22));
    return [...mapa.values()];
  }

  const ordem = [...new Set([...zonas.map(z => regiaoZona.get(z) || `Zona ${z}`), ...regiaoLocal.values()])];
  const ordenar = (x, y) => ordem.indexOf(x.regiao) - ordem.indexOf(y.regiao) || y.v26 - x.v26 || y.v22 - x.v22;
  const metricas = g => ({
    aptos_2026: g.a26, votos_2026: g.v26, pct_2026: pct(g.v26, g.a26),
    aptos_2022: g.a22, votos_2022: g.v22, pct_2022: pct(g.v22, g.a22),
    variacao: g.v26 - g.v22, variacao_pct: variacao(g.v26, g.v22),
  });

  const porRegiao = agrupar("regiao").sort(ordenar).map(g => ({ regiao: g.regiao, ...metricas(g) }));
  const porBairro = agrupar("bairro").sort(ordenar).map(g => ({ regiao: g.regiao, bairro: g.bairro, ...metricas(g) }));
  const porLocal = agrupar("local").sort(ordenar).map(g => ({
    regiao: g.regiao, bairro: g.bairro, local: g.local, nome_local: g.nome_local,
    secoes_2026: g.s26, secoes_2022: g.s22, ...metricas(g),
  }));
  const total = metricas(agrupar("regiao").reduce((t, g) => {
    for (const k of ["a26", "v26", "a22", "v22"]) t[k] += g[k];
    return t;
  }, { a26: 0, v26: 0, a22: 0, v22: 0 }));

  console.log("\nPOR REGIÃO");
  console.table(porRegiao);
  console.log("\nPOR BAIRRO");
  console.table(porBairro);
  console.log(`TOTAL: 2026 ${total.votos_2026} | 2022 ${total.votos_2022} | variação ${total.variacao} (${decimal(total.variacao_pct, 1)}%)`);

  if (prefixo) {
    const cab = ["Eleitores aptos 2026", "Votos 2026", "% aptos 2026", "Eleitores aptos 2022", "Votos 2022", "% aptos 2022",
      "Variação de votos", "Variação %"];
    const vals = m => [m.aptos_2026, m.votos_2026, decimal(m.pct_2026), m.aptos_2022, m.votos_2022, decimal(m.pct_2022),
      m.variacao, decimal(m.variacao_pct, 1)];
    salvarCsv(`${prefixo}-regioes.csv`, ["Região", ...cab],
      [...porRegiao.map(r => [campo(r.regiao), ...vals(r)].join(";")), ["TOTAL", ...vals(total)].join(";")]);
    salvarCsv(`${prefixo}-bairros.csv`, ["Região", "Bairro", ...cab],
      [...porBairro.map(r => [campo(r.regiao), campo(r.bairro), ...vals(r)].join(";")), ["TOTAL", "", ...vals(total)].join(";")]);
    salvarCsv(`${prefixo}-locais.csv`, ["Região", "Bairro", "Nº local", "Local de votação", "Seções 2026", "Seções 2022", ...cab],
      [...porLocal.map(r => [campo(r.regiao), campo(r.bairro), r.local, campo(r.nome_local), r.secoes_2026, r.secoes_2022, ...vals(r)].join(";")),
       ["TOTAL", "", "", "", "", "", ...vals(total)].join(";")]);
  }
})();
