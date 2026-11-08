// Coleta números públicos de perfis do Instagram (seguidores e curtidas/comentários das publicações recentes)
// e acrescenta uma "foto" com data e hora em redes/dados/instagram-coletas.jsonl.
// Rodando de hora em hora, as fotos formam a curva de crescimento de cada publicação.
// Uso: node redes/instagram-coletor.js [--publicacoes 50] [--perfis redes/perfis.json]
//
// Fonte: Instagram Graph API, Business Discovery (só perfis comerciais ou de criador). Precisa de um token de
// acesso de um app da Meta ligado a uma conta Instagram comercial. O token vai no cabeçalho Authorization:
// pela variável META_TOKEN ou, numa sessão do Claude Code na nuvem, pelo proxy, que o injeta sozinho.
// A API não informa visualizações de Reels nem o texto dos comentários de outras contas.

const fs = require("fs");
const path = require("path");

const API = "https://graph.facebook.com/v21.0";

function argumento(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const LIMITE = Number(argumento("--publicacoes", "50"));
const perfis = JSON.parse(fs.readFileSync(path.resolve(argumento("--perfis", path.join(__dirname, "perfis.json"))), "utf8"));
const saida = path.join(__dirname, "dados", "instagram-coletas.jsonl");

async function graph(caminho, parametros = {}) {
  const url = new URL(API + caminho);
  for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
  const cabecalhos = process.env.META_TOKEN ? { Authorization: `Bearer ${process.env.META_TOKEN}` } : {};
  for (let tentativa = 1; ; tentativa++) {
    const resposta = await fetch(url, { headers: cabecalhos });
    const corpo = await resposta.json();
    if (resposta.ok) return corpo;
    const erro = corpo.error || {};
    // 4, 17 e 32: limite de chamadas; tenta de novo algumas vezes
    if ([4, 17, 32].includes(erro.code) && tentativa < 4) {
      await new Promise(r => setTimeout(r, 30000 * tentativa));
      continue;
    }
    throw new Error(`${erro.type || resposta.status}: ${erro.message || JSON.stringify(corpo)}`);
  }
}

// Id da conta Instagram comercial ligada ao token (via páginas do Facebook), ou IG_USER_ID.
async function minhaConta() {
  if (process.env.IG_USER_ID) return process.env.IG_USER_ID;
  const { data } = await graph("/me/accounts", { fields: "name,instagram_business_account{id,username}" });
  const conta = (data || []).map(p => p.instagram_business_account).find(Boolean);
  if (!conta) throw new Error("Nenhuma conta Instagram comercial ligada às páginas do Facebook deste token.");
  console.log(`Consultando como @${conta.username} (${conta.id})`);
  return conta.id;
}

(async () => {
  const eu = await minhaConta();
  const coletadoEm = new Date().toISOString();
  const campos = "username,name,followers_count,follows_count,media_count," +
    `media.limit(${LIMITE}){id,caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink}`;
  const linhas = [];
  for (const p of perfis) {
    try {
      const { business_discovery: d } = await graph(`/${eu}`, { fields: `business_discovery.username(${p.usuario}){${campos}}` });
      linhas.push(JSON.stringify({
        coletadoEm, perfil: p.usuario, nome: p.nome, espectro: p.espectro,
        seguidores: d.followers_count, seguindo: d.follows_count, publicacoes: d.media_count,
        midias: (d.media?.data || []).map(m => ({
          id: m.id, data: m.timestamp, tipo: m.media_product_type || m.media_type, link: m.permalink,
          // like_count não vem quando o perfil esconde as curtidas
          curtidas: m.like_count ?? null, comentarios: m.comments_count ?? null,
          legenda: (m.caption || "").slice(0, 200),
        })),
      }));
      console.log(`@${p.usuario}: ${d.followers_count.toLocaleString("pt-BR")} seguidores, ${d.media?.data?.length || 0} publicações lidas`);
    } catch (erro) {
      console.error(`@${p.usuario}: ${erro.message}`);
    }
  }
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  if (linhas.length) fs.appendFileSync(saida, linhas.join("\n") + "\n");
  console.log(`${linhas.length} de ${perfis.length} perfis gravados em ${saida}`);
  if (linhas.length < perfis.length) process.exitCode = 1;
})().catch(erro => {
  console.error(erro.message);
  process.exit(1);
});
