/**
 * Upsert da coleção `codigo` (fase 5, revisão d; IMPR-008: dual-transporte).
 *
 * Entrada: chunks.json produzido pelo chunk.mjs — [{ id, text, payload }].
 * Transporte por RAG_TRANSPORTE (default qdrant), mesma env do webhook:
 *
 *   qdrant:   id UUID v5 do chunker; embedding server-side (Qdrant Cloud
 *             Inference, e5-small 384d — texto cru, prefixos injetados pelo
 *             serviço, canário cos=1.000000); rebuild delete-by-filter repo.
 *
 *   pinecone: id STRING do chunk ('codigo:<repo>:<caminho>:<linha>' — a
 *             sonda do namespace), namespace 'codigo' do índice único
 *             (modelo de embedding configurado NA CRIAÇÃO do índice:
 *             multilingual-e5-large — decisão IMPR-008; embedding por texto
 *             direto, integrated inference, cota própria de 5M tokens);
 *             rebuild idempotente = apagar namespace e regravar (o índice é
 *             cache, D6 — o reindex pode rodar quantas vezes for preciso).
 *             TASK-009: modo delta por padrão (REINDEX_MODE=delta) — compara
 *             o fingerprint de cada chunk com o armazenado e re-embeda só o
 *             que mudou; REINDEX_MODE=full (cron semanal + dispatch) faz o
 *             rebuild completo. Falha na leitura do estado cai para full.
 *             O caminho Qdrant permanece rebuild completo (rollback).
 *
 * Credenciais: env primeiro (no Actions, secrets), fallback ao registro
 * local (qdrant-key.mjs / pinecone-key.mjs) — resolvidas e nunca impressas
 * (regra 6 do AGENTS).
 *
 * Uso: node scripts/rag/upsert.mjs <chunks.json>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODELO_EMBED } from './modelo.mjs';
import { calcularDelta } from './delta.mjs';

const [arquivo] = process.argv.slice(2);
if (!arquivo) {
  console.error('Uso: node scripts/rag/upsert.mjs <pontos.json>');
  process.exit(1);
}

const TRANSPORTE = String(process.env.RAG_TRANSPORTE || 'qdrant').trim().toLowerCase();
// TASK-009: delta (default) compara fingerprints e re-embeda só o que mudou;
// full é o rebuild completo de sempre (deleteAll + upsert integral). O
// workflow manda full no cron semanal (domingo 06:00 UTC) e por dispatch.
const REINDEX_MODE = (String(process.env.REINDEX_MODE || 'delta').trim().toLowerCase() === 'full')
  ? 'full'
  : 'delta';
const REPO = process.env.GITHUB_REPOSITORY || 'local/planejador';
const COLECAO = 'codigo';
const NAMESPACE = 'codigo'; // Pinecone: namespace da coleção lógica
const LOTE = 90; // Pinecone records: máximo 96 records/request (erro canônico
                 // "Batch size exceeds 96" achado no run real, 2026-09-02);
                 // 90 dá folga. O Qdrant aceita esse lote tranquilo.
const MODELO = MODELO_EMBED; // qdrant: fonte única scripts/rag/modelo.mjs

// Credenciais: env primeiro (no Actions, secrets). Sem env, tenta o fallback
// local do registro (qdrant-key.mjs — só existe para o qdrant; no CI o env
// sempre está completo). Import DINÂMICO (aprendido no 1º run do reindex-rag).
async function credenciais() {
  if (TRANSPORTE === 'pinecone') {
    if (process.env.PINECONE_INDEX_HOST && process.env.PINECONE_API_KEY) {
      return {
        // à prova de secret colado com esquema: "https://host/" → "host"
        host: String(process.env.PINECONE_INDEX_HOST)
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\/+$/, ''),
        apiKey: process.env.PINECONE_API_KEY,
      };
    }
    console.error('FALHOU: pinecone exige PINECONE_INDEX_HOST/PINECONE_API_KEY (env ou secrets do Actions)');
    process.exit(1);
  }
  if (process.env.QDRANT_URL && process.env.QDRANT_API_KEY) {
    return { url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY };
  }
  try {
    const { resolveQdrantEnv } = await import('../qdrant-key.mjs');
    return resolveQdrantEnv();
  } catch {
    console.error(
      'FALHOU: QDRANT_URL/QDRANT_API_KEY ausentes no ambiente e scripts/qdrant-key.mjs não encontrado'
    );
    process.exit(1);
  }
}

const cred = await credenciais();

// ── Pinecone (IMPR-008, formato canônico validado 2026-09-02) ────────────────
// Índice-embed usa endpoints de RECORDS, não o REST clássico de vectors:
//   upsert: POST /records/namespaces/{ns}/upsert com NDJSON (1 record/linha,
//           Content-Type application/x-ndjson) — record: { id, text } + os
//           campos do payload do chunk (voltam como `fields` na busca).
//   delete: o /vectors/delete clássico continua válido para limpeza por id.
// Id string do chunk (mesma chave da memória): 'codigo:<repo>:<caminho>:<linha>'.
function idChunkPinecone(payload) {
  return `codigo:${payload.repo}:${payload.path}:${payload.inicio}`;
}

// Estado real do namespace para o delta (TASK-009): /vectors/list (paginado)
// enumera os IDs; /vectors/fetch (lotes de 50) lê o fingerprint armazenado.
// Ambos consomem READ UNITS — nunca tokens de embed (doc oficial).
const LOTE_FETCH = 50;

async function listarIdsPinecone(host, apiKey) {
  const ids = [];
  let token = null;
  do {
    const url = new URL(`https://${host}/vectors/list`);
    url.searchParams.set('namespace', NAMESPACE);
    if (token) url.searchParams.set('pagination_token', token);
    const resp = await fetch(url, {
      headers: { 'Api-Key': apiKey, 'X-Pinecone-Api-Version': '2025-04' },
    });
    const texto = await resp.text();
    if (!resp.ok) throw new Error(`vectors/list → HTTP ${resp.status}: ${texto.slice(0, 200)}`);
    const dados = texto ? JSON.parse(texto) : {};
    for (const v of dados.vectors || []) {
      if (v?.id) ids.push(v.id);
    }
    token = dados.pagination?.next || null;
  } while (token);
  return ids;
}

async function fetchFingerprintsPinecone(host, apiKey, ids) {
  const mapa = new Map();
  for (let i = 0; i < ids.length; i += LOTE_FETCH) {
    const lote = ids.slice(i, i + LOTE_FETCH);
    const url = new URL(`https://${host}/vectors/fetch`);
    url.searchParams.set('namespace', NAMESPACE);
    for (const id of lote) url.searchParams.append('ids', id);
    const resp = await fetch(url, {
      headers: { 'Api-Key': apiKey, 'X-Pinecone-Api-Version': '2025-04' },
    });
    const texto = await resp.text();
    if (!resp.ok) throw new Error(`vectors/fetch → HTTP ${resp.status}: ${texto.slice(0, 200)}`);
    const dados = texto ? JSON.parse(texto) : {};
    // O fingerprint pode voltar como metadata (REST clássico) ou fields
    // (records/índice-embed) — aceita as duas formas.
    for (const [id, v] of Object.entries(dados.vectors || {})) {
      const fp = v?.metadata?.fingerprint ?? v?.fields?.fingerprint;
      if (typeof fp === 'string' && fp) mapa.set(id, fp);
    }
  }
  return mapa;
}

async function upsertPinecone() {
  const { host, apiKey } = cred;
  const reqJson = async (caminho, corpo) => {
    let resp;
    try {
      resp = await fetch(`https://${host}${caminho}`, {
        method: 'POST',
        headers: {
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
          'X-Pinecone-Api-Version': '2025-04',
        },
        body: JSON.stringify(corpo),
      });
    } catch (e) {
      // fetch mudo é inaceitável em CI: a cause traz DNS/URL/TLS reais
      const causa = e?.cause?.code || e?.cause?.message || String(e && e.message ? e.message : e);
      throw new Error(`POST ${caminho} → rede falhou (host "${host}"): ${causa}`);
    }
    const texto = await resp.text();
    if (!resp.ok) throw new Error(`POST ${caminho} → HTTP ${resp.status}: ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : {};
  };

  // Upsert NDJSON em lotes (96 é o limite canônico de records/request, 90 dá
  // folga) — compartilhado pelo modo delta e pelo rebuild completo.
  const upsertarChunks = async (lista) => {
    for (let i = 0; i < lista.length; i += LOTE) {
      const lote = lista.slice(i, i + LOTE);
      const ndjson = lote
        .map((c) =>
          JSON.stringify({
            id: idChunkPinecone(c.payload),
            text: c.text,
            ...c.payload,
          })
        )
        .join('\n') + '\n';
      const resp = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/upsert`, {
        method: 'POST',
        headers: { 'Api-Key': apiKey, 'Content-Type': 'application/x-ndjson' },
        body: ndjson,
      });
      const texto = await resp.text();
      if (!resp.ok) {
        throw new Error(`upsert records → HTTP ${resp.status}: ${texto.slice(0, 300)}`);
      }
      console.log(`upsert: ${Math.min(i + LOTE, lista.length)}/${lista.length}`);
    }
  };

  const verificarContagem = async (esperado, rotulo) => {
    const stats = await fetch(`https://${host}/describe_index_stats`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const dados = await stats.json();
    const contados = dados?.namespaces?.[NAMESPACE]?.vectorCount;
    if (contados !== esperado) {
      throw new Error(
        `verificação ${rotulo} falhou: ${contados} pontos em ${NAMESPACE}, esperado ${esperado}` +
          ` (deleções de ids obsoletos bloqueadas por deletion_protection? desligue no console ou rode REINDEX_MODE=full)`
      );
    }
    console.log(`OK (${rotulo}): namespace ${NAMESPACE} com ${contados} pontos de ${REPO}`);
  };

  // ── Modo delta (TASK-009): re-embeda só o que mudou ────────────────────────
  // Otimização, nunca corretude: qualquer falha no leitura do estado cai para
  // o rebuild completo logo abaixo (fallback). Com erro no MEIO do delta
  // (verificação final), o full também converge — deleteAll + upsert integral.
  if (REINDEX_MODE === 'delta') {
    try {
      console.log('modo delta: comparando fingerprints com o estado do índice…');
      const idsExistentes = await listarIdsPinecone(host, apiKey);
      const existentes = idsExistentes.length
        ? await fetchFingerprintsPinecone(host, apiKey, idsExistentes)
        : new Map();
      if (idsExistentes.length > 0 && existentes.size === 0) {
        console.log(
          `aviso: ${idsExistentes.length} records listados e nenhum fingerprint devolvido —` +
            ` first run (records no formato antigo) ou fetch sem fields neste índice;` +
            ` todos serão tratados como alterados (re-embed integral nesta execução).`
        );
      }
      const desejados = chunks.map((c) => ({ ...c, id: idChunkPinecone(c.payload) }));
      const delta = calcularDelta(desejados, existentes);
      console.log(
        `delta: ${delta.aUpsertar.length} a upsertar · ${delta.inalterados} inalterados (poupados de re-embed) · ${delta.aDeletar.length} ids obsoletos a deletar`
      );

      // Ids que sumiram da árvore (arquivo removido/renomeado). Deletion
      // protection pode bloquear: aviso aqui, a verificação final é que
      // falha alta com o remédio se sobrar órfão.
      for (let i = 0; i < delta.aDeletar.length; i += 100) {
        const lote = delta.aDeletar.slice(i, i + 100);
        try {
          await reqJson('/vectors/delete', { namespace: NAMESPACE, ids: lote, wait: true });
          console.log(`delete: ${Math.min(i + 100, delta.aDeletar.length)}/${delta.aDeletar.length} ids obsoletos`);
        } catch (e) {
          console.log(
            `aviso: delete de ${lote.length} ids obsoletos falhou (${String(e && e.message ? e.message : e).slice(0, 140)})`
          );
        }
      }

      await upsertarChunks(delta.aUpsertar);
      await verificarContagem(chunks.length, 'delta');
      console.log(`economia do delta: ${delta.inalterados}/${chunks.length} chunks não re-embedados nesta execução.`);
      return;
    } catch (e) {
      console.log(`delta indisponível (${String(e && e.message ? e.message : e).slice(0, 240)}) — caindo para rebuild completo.`);
    }
  }

  // ── Rebuild completo (modo full ou fallback do delta) ──────────────────────
  // Rebuild idempotente: apaga o namespace inteiro e regrava (o índice é
  // cache, D6). NOTA: deletion_protection (a UI liga por padrão) pode
  // bloquear deleteAll — NÃO é fatal: os ids determinísticos fazem o
  // upsert substituir os pontos antigos; o deleteAll é só higiene.
  try {
    await reqJson('/vectors/delete', { namespace: NAMESPACE, deleteAll: true });
    console.log(`rebuild: namespace ${NAMESPACE} apagado`);
  } catch (e) {
    console.log(`rebuild: deleteAll indisponível (${String(e && e.message ? e.message : e).slice(0, 120)}) — seguindo por upsert idempotente`);
  }

  await upsertarChunks(chunks);

  await verificarContagem(chunks.length, 'full');
}

// ── Qdrant (fases 1-6, inalterado) ──────────────────────────────────────────
const base = String(cred.url || '').replace(/\/+$/, '');
const apiKey = cred.apiKey;

async function qdrant(metodo, caminho, corpo, tentativas = 3) {
  for (let i = 1; i <= tentativas; i++) {
    const resp = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resp.text();
    // 429/5xx no caminho de inferência são transientes (rate limit do serviço
    // de embedding): 2 retries com espera crescente antes de falhar o run.
    if ((resp.status === 429 || resp.status >= 500) && i < tentativas) {
      const espera = i * 5000;
      console.error(`HTTP ${resp.status} em ${caminho} — retry ${i}/${tentativas - 1} em ${espera}ms`);
      await new Promise((r) => setTimeout(r, espera));
      continue;
    }
    if (!resp.ok) {
      // Corpo de resposta não contém a chave (ela vai só no header da request).
      throw new Error(`${metodo} ${caminho} → HTTP ${resp.status}: ${texto.slice(0, 300)}`);
    }
    return texto ? JSON.parse(texto) : {};
  }
}

const chunks = await (async () => {
  try {
    return JSON.parse(readFileSync(resolve(arquivo), 'utf8'));
  } catch (e) {
    console.error('FALHOU: não consegui ler/parsing ' + arquivo + ' — ' + String(e.message || e));
    process.exit(1);
  }
})();
if (!Array.isArray(chunks) || !chunks.length) {
  console.error('FALHOU: chunks.json vazio ou inválido');
  process.exit(1);
}
for (const c of chunks) {
  if (!c.id || typeof c.text !== 'string' || !c.text.trim() || !c.payload?.path) {
    console.error(`FALHOU: chunk ${c.id || '?'} inválido (text + payload.path obrigatórios)`);
    process.exit(1);
  }
}

try {
  if (TRANSPORTE === 'pinecone') {
    await upsertPinecone();
  } else {
    // Índice keyword em `repo`: o Qdrant exige índice para filtrar por esse
    // campo enquanto a coleção está vazia (sem pontos, o tipo do campo não é
    // inferível — aprendido no 2º run do reindex-rag: delete-by-filter → HTTP
    // 400 "Index required but not found"). Cobre o delete e a contagem final.
    // Idempotente: recriar índice existente é no-op.
    await qdrant('PUT', `/collections/${COLECAO}/index`, {
      field_name: 'repo',
      field_schema: 'keyword',
    });
    console.log(`índice payload repo (keyword) garantido em ${COLECAO}`);

    await qdrant('POST', `/collections/${COLECAO}/points/delete?wait=true`, {
      filter: { must: [{ key: 'repo', match: { value: REPO } }] },
    });
    console.log(`rebuild: pontos anteriores de ${REPO} apagados de ${COLECAO}`);

    for (let i = 0; i < chunks.length; i += LOTE) {
      const lote = chunks
        .slice(i, i + LOTE)
        .map((c) => ({ id: c.id, vector: { text: c.text, model: MODELO }, payload: c.payload }));
      await qdrant('PUT', `/collections/${COLECAO}/points?wait=true`, { points: lote });
      console.log(`upsert: ${Math.min(i + LOTE, chunks.length)}/${chunks.length}`);
    }

    // O Qdrant embrulha a resposta em "result": { result: { count: N }, status }.
    // (3º run do reindex-rag: ler contagem.count direto dava undefined.)
    const contagem = await qdrant('POST', `/collections/${COLECAO}/points/count`, {
      exact: true,
      filter: { must: [{ key: 'repo', match: { value: REPO } }] },
    });
    const contados = contagem?.result?.count ?? contagem?.count;
    if (contados !== chunks.length) {
      throw new Error(
        `verificação falhou: ${contados} pontos de ${REPO} em ${COLECAO}, esperado ${chunks.length}`
      );
    }
    console.log(`OK: ${COLECAO} com ${contados} pontos de ${REPO}`);
  }
} catch (e) {
  console.error('FALHOU: ' + String(e && e.message ? e.message : e));
  process.exit(1);
}
