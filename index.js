// Exemplo de execução JavaScript que processa dados e apresenta um retorno.
// Uso: node index.js [--json]

const vendas = [
  { id: 1, cliente: 'Ana Souza', produto: 'Notebook', categoria: 'Informática', quantidade: 1, precoUnitario: 4200.0, data: '2026-09-02' },
  { id: 2, cliente: 'Bruno Lima', produto: 'Mouse', categoria: 'Acessórios', quantidade: 3, precoUnitario: 89.9, data: '2026-09-05' },
  { id: 3, cliente: 'Carla Dias', produto: 'Monitor', categoria: 'Informática', quantidade: 2, precoUnitario: 1150.0, data: '2026-09-11' },
  { id: 4, cliente: 'Ana Souza', produto: 'Teclado', categoria: 'Acessórios', quantidade: 1, precoUnitario: 249.0, data: '2026-09-15' },
  { id: 5, cliente: 'Diego Alves', produto: 'Headset', categoria: 'Áudio', quantidade: 2, precoUnitario: 399.0, data: '2026-09-20' },
  { id: 6, cliente: 'Bruno Lima', produto: 'Webcam', categoria: 'Acessórios', quantidade: 1, precoUnitario: 320.0, data: '2026-09-28' },
];

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function totalDaVenda(venda) {
  return venda.quantidade * venda.precoUnitario;
}

function agruparPor(lista, chave) {
  return lista.reduce((acc, venda) => {
    const grupo = venda[chave];
    acc[grupo] = (acc[grupo] || 0) + totalDaVenda(venda);
    return acc;
  }, {});
}

function gerarRelatorio(dados) {
  const faturamentoTotal = dados.reduce((soma, v) => soma + totalDaVenda(v), 0);
  const itensVendidos = dados.reduce((soma, v) => soma + v.quantidade, 0);
  const porCategoria = agruparPor(dados, 'categoria');
  const porCliente = agruparPor(dados, 'cliente');
  const [melhorCliente, valorMelhorCliente] = Object.entries(porCliente).sort((a, b) => b[1] - a[1])[0];

  return {
    totalDeVendas: dados.length,
    itensVendidos,
    faturamentoTotal,
    ticketMedio: faturamentoTotal / dados.length,
    porCategoria,
    melhorCliente: { nome: melhorCliente, valor: valorMelhorCliente },
  };
}

function exibir(relatorio, dados) {
  console.log('=== Vendas ===');
  console.table(
    dados.map((v) => ({
      Cliente: v.cliente,
      Produto: v.produto,
      Qtd: v.quantidade,
      Total: moeda.format(totalDaVenda(v)),
    }))
  );

  console.log('\n=== Faturamento por categoria ===');
  console.table(
    Object.entries(relatorio.porCategoria).map(([categoria, valor]) => ({
      Categoria: categoria,
      Valor: moeda.format(valor),
      Participação: ((valor / relatorio.faturamentoTotal) * 100).toFixed(1) + '%',
    }))
  );

  console.log('\n=== Resumo ===');
  console.log(`Total de vendas:   ${relatorio.totalDeVendas}`);
  console.log(`Itens vendidos:    ${relatorio.itensVendidos}`);
  console.log(`Faturamento total: ${moeda.format(relatorio.faturamentoTotal)}`);
  console.log(`Ticket médio:      ${moeda.format(relatorio.ticketMedio)}`);
  console.log(`Melhor cliente:    ${relatorio.melhorCliente.nome} (${moeda.format(relatorio.melhorCliente.valor)})`);
}

const relatorio = gerarRelatorio(vendas);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(relatorio, null, 2));
} else {
  exibir(relatorio, vendas);
}

module.exports = { gerarRelatorio, totalDaVenda, agruparPor };
