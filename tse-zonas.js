// Votos de um candidato por zona eleitoral do DF, com a abrangência de cada zona (TRE-DF).
// Uso: node tse-zonas.js

// Abrangência das zonas conforme as páginas "Zonas Eleitorais" do site do TRE-DF.
const abrangencia = {
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

(async () => {

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
      `${base}/df97012-z${z}-c0006-e006259-u.json`;

    const resposta = await fetch(url, { cache: "no-store" });

    if (!resposta.ok) {
      console.warn("Erro na zona", zona, resposta.status);
      continue;
    }

    const dados = await resposta.json();

    let candidato = null;
    let partido = null;

    for (const cargo of (dados.carg || [])) {

      if (Number(cargo.cd) !== 6) continue;

      for (const agrupamento of (cargo.agr || [])) {

        for (const par of (agrupamento.par || [])) {

          for (const cand of (par.cand || [])) {

            if (String(cand.n) === "2200") {
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

    resultado.push({
      zona: zona,
      candidato: candidato ? `${candidato.nmu}/${partido}` : null,
      votos: votos,
      eleitores_aptos: eleitores,
      percentual_aptos:
        eleitores
          ? Number((votos / eleitores * 100).toFixed(1))
          : 0,
      abrangencia: abrangencia[zona] || ""
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

  console.log(
    "TOTAL DE VOTOS:",
    resultado.reduce((soma, x) => soma + x.votos, 0)
  );

  return resultado;

})();
