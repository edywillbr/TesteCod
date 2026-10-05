// Votos de um candidato por zona eleitoral do DF, com a abrangência de cada zona (TRE-DF).
// Uso: node tse-zonas.js [numero] [--csv arquivo.csv]
//   numero: número do candidato (padrão: 2200); também aceita --numero 2200
//   --numero2022: número usado em 2022, se for diferente (precisa ser do mesmo cargo)
//   O cargo vem do tamanho do número: 4 dígitos = Deputado Federal, 5 dígitos = Deputado Distrital.
// A abrangência é lida das páginas de cada zona no site do TRE-DF.
// Os números de 2022 vêm de dados/votos-2022-df.csv e dados/aptos-2022-df.csv, extraídos dos
// arquivos votacao_candidato_munzona_2022 e detalhe_votacao_munzona_2022 do Portal de Dados
// Abertos do TSE (https://dadosabertos.tse.jus.br).

// Texto de reserva, usado só quando não for possível ler a página da zona no site do TRE-DF.
const abrangenciaReserva = {
  1: "Asa Sul, Vila Telebrasília, Setor Hoteleiro Sul, Setor de Clubes Sul, Setor Policial Sul, Setor de Múltiplas Atividades Sul e Setor de Autarquias Sul",
  2: "Paranoá, Itapoã, Lago Norte, Varjão, Taquari, Granja do Torto e núcleos rurais da região",
  3: "Taguatinga Norte (CNL, QNJ, QNL, EQNL, EQNM e QNM 34 a 42, Setor de Desenvolvimento Econômico e Setor de Indústrias Gráficas de Taguatinga Norte) e Núcleo Rural de Taguatinga Norte",
  4: "Santa Maria e condomínios e núcleos rurais da região",
  5: "Sobradinho, Fercal, Colorado, condomínios e zonas rurais da região",
  6: "Planaltina, Setor Tradicional, Tabatinga, Rio Preto, Pipiripau II, São José, Rajadinha, Estância Mestre D'Armas, outros bairros e núcleos rurais da região",
  8: "Ceilândia: Setor QNM, Setor QNN, Setor P Norte (menos QNP 17, QNP 19, EQNP 13/17 e EQNP 15/19), CNN 1, CNM 1 e CNM 2, Parque Sol Nascente (lado P Norte)",
  9: "Guará I, Guará II, Colônia Agrícola Águas Claras, Colônia Agrícola Bernardo Sayão, Colônia Agrícola IAPI, Quadras Econômicas Lucio Costa, SIA, Setor de Oficinas Sul, Setor de Garagens e Concessionárias de Veículos, Setor de Clubes e Estádios Esportivos Sul",
  10: "Núcleo Bandeirante, Divinéia, Metropolitana, Vila Cauhy, Setor de Mansões Park Way, Núcleo Rural Vargem Bonita",
  11: "Cruzeiro Velho, Cruzeiro Novo, Octogonal, Setor Militar Urbano – SMU, Setor Militar Complementar, Setor de Abastecimento Norte, Sudoeste e Setor de Indústrias Gráficas",
  13: "Samambaia (exceto as quadras 500 e QR 317) e residenciais e condomínios da região",
  14: "Asa Norte, Vila Planalto, Setor de Oficinas Norte e Setor Noroeste",
  15: "Taguatinga Sul, Taguatinga Centro, Setor QNA, Arniqueira, Setor de Mansões Leste, Águas Claras",
  16: "Ceilândia Norte: QNO, QNQ, QNR, CNR, Expansão do P Norte, QNP 17 e 19, EQNP 13/17 e 15/19, Setor de Indústria de Ceilândia e núcleos rurais",
  17: "Gama (Setores Leste, Oeste, Sul, Norte, Industrial e Central) e zonas rurais Tamanduá, EMBRAPA, Córrego Barreiro, Ponte Alta, Engenho das Lages, Casa Grande e Cachoeirinha",
  18: "Lago Sul, Jardim Botânico, São Sebastião, Jardins Mangueiral, condomínios e núcleos rurais da região",
  19: "Taguatinga Norte (exceto QNA, QNJ, QNL, EQNL, QNM 36 e 42, EQNM, SDE e Núcleo Rural de Taguatinga Norte), Colônia Agrícola Samambaia, Vicente Pires",
  20: "Ceilândia (Setor P Sul e setores QNN)",
  21: "Recanto das Emas, Samambaia (Quadras 500 e QR 317) e Núcleo Rural Monjolo",
};

const baseTre =
  "https://www.tre-df.jus.br/servicos-eleitorais/zonas-eleitorais";

// Endereço padrão das páginas; a 14ª usa "14a-...-telefone", por isso as variações.
function urlsDaZona(zona) {
  return [
    `${baseTre}/${zona}o-zona-eleitoral-endereco-e-telefones`,
    `${baseTre}/${zona}a-zona-eleitoral-endereco-e-telefone`,
    `${baseTre}/${zona}a-zona-eleitoral-endereco-e-telefones`,
    `${baseTre}/${zona}o-zona-eleitoral-endereco-e-telefone`,
  ];
}

function htmlParaTexto(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|strong|b)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/[ \t]+/g, " ");
}

// Pega o texto que vem depois de "Abrangência" até o próximo rótulo da página.
function extrairAbrangencia(html) {
  const texto = htmlParaTexto(html);
  const inicio = texto.search(/abrang[êe]ncia/i);
  if (inicio < 0) return null;

  const linhas = texto
    .slice(inicio)
    .replace(/^abrang[êe]ncia\s*:?/i, "")
    .split("\n")
    .map(l => l.trim());

  const rotulo =
    /^(endere[çc]o|telefone|exclusivo|whats ?app|e-?mail|chefe|ju[ií]z|hor[áa]rio|atendimento|compartilhe|voltar|mapa|cep)\b/i;

  const partes = [];
  for (const linha of linhas) {
    if (!linha) continue;
    if (rotulo.test(linha)) break;
    partes.push(linha.replace(/^:\s*/, ""));
    if (partes.join(" ").length > 3000) break;
  }

  const resultado = partes.join(" ").replace(/\s+/g, " ").trim();
  return resultado || null;
}

async function buscarAbrangencia(zona) {
  for (const url of urlsDaZona(zona)) {
    try {
      const resposta = await fetch(url, { cache: "no-store" });
      if (!resposta.ok) continue;
      const texto = extrairAbrangencia(await resposta.text());
      if (texto) return texto;
    } catch {
      // tenta a próxima variação do endereço
    }
  }
  console.warn(`Zona ${zona}: abrangência não lida do site do TRE-DF, usando texto de reserva`);
  return abrangenciaReserva[zona] || "";
}

function lerCsvLocal(nome) {
  const caminho = require("path").join(__dirname, "dados", nome);
  const [cabecalho, ...linhas] = require("fs").readFileSync(caminho, "utf8").trim().split(/\r?\n/);
  const colunas = cabecalho.split(";");
  return linhas.map(l => {
    const valores = l.split(";");
    return Object.fromEntries(colunas.map((c, i) => [c, valores[i]]));
  });
}

// Votos e eleitores aptos de 2022 por zona, para o mesmo número e cargo.
function carregar2022(numero, codigoCargo) {
  const votos = lerCsvLocal("votos-2022-df.csv")
    .filter(r => r.numero === numero && Number(r.cargo) === codigoCargo);
  const aptos = lerCsvLocal("aptos-2022-df.csv")
    .filter(r => Number(r.cargo) === codigoCargo);
  return {
    candidato: votos.length ? votos[0] : null,
    votosPorZona: Object.fromEntries(votos.map(r => [Number(r.zona), Number(r.votos)])),
    aptosPorZona: Object.fromEntries(aptos.map(r => [Number(r.zona), Number(r.aptos)])),
  };
}

const decimal = (v, casas = 1) => (v == null ? "" : v.toFixed(casas).replace(".", ","));

// CSV com ";" e vírgula decimal, para abrir direto no Excel em português.
function salvarCsv(arquivo, linhas, totalVotos, totalVotos2022) {
  const campo = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cabecalho = [
    "Zona", "Candidato/Sigla", "Votos 2026", "Eleitores aptos 2026", "% dos aptos 2026",
    "Votos 2022", "Eleitores aptos 2022", "% dos aptos 2022", "Variação de votos", "Variação %",
    "Abrangência",
  ];
  const corpo = linhas.map(l => [
    l.zona,
    campo(l.candidato),
    l.votos,
    l.eleitores_aptos,
    decimal(l.percentual_aptos),
    l.votos_2022 ?? "",
    l.eleitores_aptos_2022 ?? "",
    decimal(l.percentual_aptos_2022),
    l.variacao_votos ?? "",
    decimal(l.variacao_percentual),
    campo(l.abrangencia),
  ].join(";"));
  const rodape = [
    "TOTAL", "", totalVotos, "", "", totalVotos2022 ?? "", "", "",
    totalVotos2022 != null ? totalVotos - totalVotos2022 : "",
    decimal(variacao(totalVotos, totalVotos2022)), "",
  ].join(";");
  require("fs").writeFileSync(
    arquivo,
    "\uFEFF" + [cabecalho.join(";"), ...corpo, rodape].join("\r\n") + "\r\n"
  );
}

function variacao(atual, anterior) {
  return anterior ? Number(((atual / anterior - 1) * 100).toFixed(1)) : null;
}

module.exports = { extrairAbrangencia };

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

if (require.main === module) (async () => {

  const posicional = process.argv
    .slice(2)
    .find((a, i, args) => /^\d+$/.test(a) && !String(args[i - 1]).startsWith("--numero"));
  const numero = String(argumento("--numero", posicional || "2200")).trim();

  const cargos = { 4: { codigo: 6, nome: "Deputado Federal" }, 5: { codigo: 8, nome: "Deputado Distrital" } };
  const cargo = /^\d+$/.test(numero) ? cargos[numero.length] : null;
  if (!cargo) {
    console.error(`Número inválido: "${numero}". Use 4 dígitos (Deputado Federal) ou 5 dígitos (Deputado Distrital).`);
    process.exit(1);
  }
  const codigoCargo = cargo.codigo;
  console.log(`Candidato ${numero} — ${cargo.nome}`);
  const c = String(codigoCargo).padStart(4, "0");

  const numero2022 = String(argumento("--numero2022", numero)).trim();
  if (cargos[numero2022.length]?.codigo !== codigoCargo) {
    console.error(`O número de 2022 (${numero2022}) precisa ser do mesmo cargo (mesma quantidade de dígitos).`);
    process.exit(1);
  }

  const dados2022 = carregar2022(numero2022, codigoCargo);
  const cand2022 = dados2022.candidato;
  if (cand2022) {
    console.log(`2022 (nº ${numero2022}): ${cand2022.nome_urna}/${cand2022.partido} — ${cand2022.situacao}`);
  } else {
    console.log(`2022: nenhum candidato com o número ${numero2022} para ${cargo.nome}`);
  }

  const zonas = [
    1, 2, 3, 4, 5, 6, 8, 9, 10, 11,
    13, 14, 15, 16, 17, 18, 19, 20, 21
  ];

  const base =
    "https://resultados.tse.jus.br/oficial/ele2026/6259/dados/df";

  const resultado = [];

  for (const zona of zonas) {

    const z = String(zona).padStart(4, "0");

    const url =
      `${base}/df97012-z${z}-c${c}-e006259-u.json`;

    const resposta = await fetch(url, { cache: "no-store" });

    if (!resposta.ok) {
      console.warn("Erro na zona", zona, resposta.status);
      continue;
    }

    const dados = await resposta.json();

    let candidato = null;
    let partido = null;

    for (const cargo of (dados.carg || [])) {

      if (Number(cargo.cd) !== codigoCargo) continue;

      for (const agrupamento of (cargo.agr || [])) {

        for (const par of (agrupamento.par || [])) {

          for (const cand of (par.cand || [])) {

            if (String(cand.n) === numero) {
              candidato = cand;
              partido = par.sg;
              break;
            }

          }

          if (candidato) break;
        }

        if (candidato) break;
      }

      if (candidato) break;
    }

    const votos = Number(candidato?.vap || 0);
    const eleitores = Number(dados.e?.te || 0);

    const votos2022 = cand2022 ? (dados2022.votosPorZona[zona] || 0) : null;
    const eleitores2022 = dados2022.aptosPorZona[zona] ?? null;

    resultado.push({
      zona: zona,
      candidato: candidato ? `${candidato.nmu}/${partido}` : null,
      votos: votos,
      eleitores_aptos: eleitores,
      percentual_aptos:
        eleitores
          ? Number((votos / eleitores * 100).toFixed(1))
          : 0,
      votos_2022: votos2022,
      eleitores_aptos_2022: eleitores2022,
      percentual_aptos_2022:
        votos2022 != null && eleitores2022
          ? Number((votos2022 / eleitores2022 * 100).toFixed(1))
          : null,
      variacao_votos: votos2022 != null ? votos - votos2022 : null,
      variacao_percentual: votos2022 != null ? variacao(votos, votos2022) : null,
      abrangencia: await buscarAbrangencia(zona)
    });

    // pequena pausa para não gerar requisições desnecessariamente rápidas
    await new Promise(r => setTimeout(r, 100));
  }

  // ordena pelo percentual exato, para não empatar após o arredondamento
  resultado.sort(
    (a, b) =>
      b.votos / (b.eleitores_aptos || 1) - a.votos / (a.eleitores_aptos || 1)
  );

  console.table(resultado);

  const totalVotos = resultado.reduce((soma, x) => soma + x.votos, 0);

  console.log("TOTAL DE VOTOS 2026:", totalVotos);

  const totalVotos2022 = cand2022
    ? resultado.reduce((soma, x) => soma + x.votos_2022, 0)
    : null;

  if (cand2022) {
    const nome2026 = resultado.find(x => x.candidato)?.candidato.split("/")[0];
    console.log(
      "TOTAL DE VOTOS 2022:", totalVotos2022,
      `(variação: ${totalVotos - totalVotos2022 >= 0 ? "+" : ""}${totalVotos - totalVotos2022}, ` +
      `${decimal(variacao(totalVotos, totalVotos2022))}%)`
    );
    const semAcento = t => t.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();
    if (nome2026 && semAcento(nome2026) !== semAcento(cand2022.nome_urna)) {
      console.warn(
        `Atenção: em 2022 o número ${numero2022} era de ${cand2022.nome_urna}/${cand2022.partido}, ` +
        `não de ${nome2026}. A comparação é entre candidatos diferentes.`
      );
    }
  }

  if (process.argv.includes("--csv")) {
    const arquivo = argumento("--csv", `resultado-zonas-${numero}.csv`);
    salvarCsv(arquivo, resultado, totalVotos, totalVotos2022);
    console.log("CSV salvo em", arquivo);
  }

  return resultado;

})();
