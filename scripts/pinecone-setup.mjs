/**
 * Setup/verificação idempotente do índice Pinecone do RAG (IMPR-008).
 * Análogo ao scripts/qdrant-setup.mjs das fases 1-3.
 *
 * O que faz (idempotente — rodar de novo é seguro):
 *   1. Verifica se o índice RAG existe (lista índices da org);
 *   2. Não existe → CRIA: serverless (AWS us-east-1), dimension 1024,
 *      metric cosine, cloud: aws, region: us-east-1 — e o modelo de
 *      embedding multilingual-e5-large configurado NA CRIAÇÃO (integrated
 *      inference: upsert/query por texto, cota própria de 5M tokens —
 *      decisão do IMPR-008; e5-small NÃO existe no free do Pinecone);
 *   3. Existe → confere dimension/metric/host e mostra contagens por
 *      namespace (codigo, bugs_resolvidos, decisoes_arquitetura);
 *   4. Smoke test de escrita/leitura/delete no namespace 'codigo'
 *      (atividade real; o Pinecone NÃO suspende por idle — o smoke é
 *      só verificação de funciona, não keep-alive).
 *
 * Credenciais: PINECONE_API_KEY (env ou registro via qdrant-key.mjs com
 * PINECONE_API_KEY no HKCU). O INDEX_NAME e INDEX_HOST saem de env com
 * defaults fixos do projeto (rag-planejador).
 *
 * Uso: node scripts/pinecone-setup.mjs [--sem-smoke]
 */

import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'rag-planejador';
const DIMENSAO = 1024; // multilingual-e5-large (decisão IMPR-008)
const METRICA = 'cosine';
const EMBED_MODEL = 'multilingual-e5-large'; // catálogo free do Pinecone
const NAMESPACES = ['codigo', 'bugs_resolvidos', 'decisoes_arquitetura'];
const SEM_SMOKE = process.argv.includes('--sem-smoke');

function apiKeyRegistro() {
  const tmp = join(tmpdir(), `pinecone-key-${process.pid}.tmp`);
  try {
    execSync(`reg query HKCU\\Environment /v PINECONE_API_KEY > "${tmp}"`, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const m = readFileSync(tmp, 'utf8').match(/PINECONE_API_KEY\s+REG_SZ\s+(\S+)/);
    return m ? m[1] : '';
  } catch {
    return '';
  } finally {
    try { unlinkSync(tmp); } catch { /* já removido */ }
  }
}

const API_KEY = process.env.PINECONE_API_KEY || apiKeyRegistro();
if (!API_KEY) {
  console.error('FALHOU: PINECONE_API_KEY ausente (env ou registro HKCU). Crie a key no console do Pinecone.');
  process.exit(1);
}

const CONTROLE = 'https://api.pinecone.io/indexes';

async function pinecone(metodo, caminho, corpo) {
  const resp = await fetch(CONTROLE + caminho, {
    method: metodo,
    headers: { 'Api-Key': API_KEY, 'Content-Type': 'application/json', 'X-Source': 'rag-planejador-setup' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    throw new Error(`${metodo} ${caminho} → HTTP ${resp.status}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : {};
}

try {
  // 1-2. índice existe? (a UI pode tê-lo criado/convertido com embed — o
  // REST de criação ignora o campo embed nesta org: campo aceito (201) mas
  // não aplicado, verificado 2026-09-02; índice-embed só nasce pela UI ou
  // SDK. Se o índice existir SEM embed, instruimos a converter pela UI.)
  const lista = await pinecone('GET', '');
  const achado = (lista.indexes || []).find((i) => i.name === INDEX_NAME);
  let host;
  if (!achado) {
    console.log(`índice ${INDEX_NAME} não existe — criando via REST (serverless, ${DIMENSAO}d, ${METRICA})...`);
    console.log('AVISO IMPORTANTE: o REST pode criar o índice SEM o modelo de embedding (comportamento');
    console.log('  observado nesta org: o campo embed é aceito e ignorado). Depois da criação, ABRIR O');
    console.log('  CONSOLE → índice → Settings/Embedding → selecionar multilingual-e5-large com');
    console.log('  field map text → text (a UI converte o índice em integrated inference).');
    const criado = await pinecone('POST', '', {
      name: INDEX_NAME,
      dimension: DIMENSAO,
      metric: METRICA,
      spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
    });
    host = criado?.host;
    console.log(`índice criado. host: ${host || '(confira no console)'}`);
  } else {
    host = achado.host;
    console.log(`índice ${INDEX_NAME} existe. host: ${host}`);
  }

  if (!host) {
    const recarregado = await pinecone('GET', `/${INDEX_NAME}`);
    host = recarregado?.host;
  }

  // Confere o EMBED com o header de versão (o describe padrão não mostra —
  // verificado; com X-Pinecone-Api-Version 2025-04 o campo embed aparece).
  const desc = await fetch('https://api.pinecone.io/indexes/' + INDEX_NAME, {
    headers: { 'Api-Key': API_KEY, 'X-Pinecone-Api-Version': '2025-04' },
  });
  const dj = await desc.json();
  if (dj?.embed?.model) {
    console.log(`embed ativo: ${dj.embed.model} (dim ${dj.embed.dimension || '?'}, field_map ${JSON.stringify(dj.embed.field_map || {})})`);
    if (dj.embed.model !== EMBED_MODEL) {
      console.log(`AVISO: modelo divergente — índice tem ${dj.embed.model}, planejado ${EMBED_MODEL}`);
    }
  } else {
    console.log('AVISO: índice SEM integrated inference (embed ausente no describe).');
    console.log('  Sem isso, o upsert/busca por texto falha (dimension 0). Converter pela UI:');
    console.log('  console.pinecone.io → índice → embedding → multilingual-e5-large, field map text→text.');
  }

  console.log(`\nPINECONE_INDEX_HOST = ${host}`);
  console.log('  ^ configure esta env na Vercel e nos secrets do Actions.');

  // 3. contagens por namespace
  const stats = await fetch(`https://${host}/describe_index_stats`, {
    method: 'POST',
    headers: { 'Api-Key': API_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const dadosStats = await stats.json();
  console.log('\ncontagens por namespace:');
  for (const ns of NAMESPACES) {
    const n = dadosStats?.namespaces?.[ns]?.vectorCount ?? 0;
    console.log(`  ${ns}: ${n}`);
  }

  // 4. smoke (pula com --sem-smoke) — formato canônico dos índice-embed
  //    (validado em produção 2026-09-02): upsert de RECORD NDJSON +
  //    search de records por texto. O REST clássico (/vectors/upsert,
  //    /query) NÃO aceita texto em índice-embed.
  if (!SEM_SMOKE) {
    console.log('\nsmoke: records/upsert (NDJSON) → records/search (texto) → delete');
    const dataHost = `https://${host}`;
    const idSmoke = 'smoke:setup';
    const up = await fetch(`${dataHost}/records/namespaces/codigo/upsert`, {
      method: 'POST',
      headers: { 'Api-Key': API_KEY, 'Content-Type': 'application/x-ndjson' },
      body: JSON.stringify({ id: idSmoke, text: 'smoke test do pinecone setup — vetor temporario' }) + '\n',
    });
    if (!up.ok) throw new Error('smoke upsert falhou: HTTP ' + up.status + ' ' + (await up.text()).slice(0, 200));
    const q = await fetch(`${dataHost}/records/namespaces/codigo/search`, {
      method: 'POST',
      headers: { 'Api-Key': API_KEY, 'Content-Type': 'application/json', 'X-Pinecone-Api-Version': '2025-04' },
      body: JSON.stringify({ query: { top_k: 1, inputs: { text: 'smoke test temporario' } } }),
    });
    const qd = await q.json();
    const achouSmoke = (qd?.result?.hits || []).some((h) => h._id === idSmoke);
    if (!achouSmoke) throw new Error('smoke search não achou o record recém-criado: ' + JSON.stringify(qd).slice(0, 200));
    const del = await fetch(`${dataHost}/vectors/delete`, {
      method: 'POST',
      headers: { 'Api-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: 'codigo', ids: [idSmoke] }),
    });
    if (!del.ok) throw new Error('smoke delete falhou: HTTP ' + del.status);
    console.log('smoke OK: escrita, leitura (por texto!) e delete funcionando — integrated inference validada');
  }

  console.log('\nsetup concluído.');
} catch (e) {
  console.error('FALHOU: ' + String(e && e.message ? e.message : e));
  process.exit(1);
}
