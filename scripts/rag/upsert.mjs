/**
 * Upsert da coleção `codigo` no Qdrant (fase 5, revisão d; design-rag-fase0.md,
 * D2 + D6 + D1-rev).
 *
 * Entrada: chunks.json produzido pelo chunk.mjs — [{ id, text, payload }],
 * id já UUID v5 determinístico do chunker. O embedding é gerado SERVER-SIDE
 * pelo Qdrant Cloud Inference (modelo `intfloat/multilingual-e5-small`, 384d,
 * free tier — verificado por canário local em 2026-09-XX): o vetor é enviado
 * como Inference Object `{ text, model }` e os prefixos e5 (`passage: `/
 * `query: `) são injetados pelo serviço (canário: cos(A,B)=1.000000) — o texto
 * vai CRU nos dois lados. Paridade D1 deixa de existir como risco; embed.py
 * fica no repo como fallback documentado (exige prefixos manuais), fora do
 * pipeline ativo.
 *
 * Rebuild (D6): primeiro garante o índice keyword em `repo` (exigido pelo
 * filtro com a coleção vazia), depois delete-by-filter de tudo que tem o
 * `repo` do run (wait=true) e upsert em lotes de 100 (wait=true) —
 * idempotente, o workflow `reindex-rag` pode rodar quantas vezes for
 * preciso. O index é cache: nunca é fonte de verdade.
 *
 * Credenciais: QDRANT_URL/QDRANT_API_KEY via env (no Actions, secrets) com
 * fallback ao registro local via qdrant-key.mjs — resolvidas e nunca
 * impressas (regra 6 do AGENTS).
 *
 * Uso: node scripts/rag/upsert.mjs <chunks.json>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODELO_EMBED } from './modelo.mjs';

const [arquivo] = process.argv.slice(2);
if (!arquivo) {
  console.error('Uso: node scripts/rag/upsert.mjs <pontos.json>');
  process.exit(1);
}

// Credenciais: env primeiro (no Actions, secrets). Sem env, tenta o fallback
// local do qdrant-key.mjs (registro do Windows). Import DINÂMICO porque esse
// arquivo pode não existir no repo do CI — lá o env sempre está completo
// (aprendido no primeiro run do reindex-rag: import estático quebrou o job).
async function credenciais() {
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

const { url, apiKey } = await credenciais();
const base = String(url).replace(/\/+$/, '');
const REPO = process.env.GITHUB_REPOSITORY || 'local/planejador';
const COLECAO = 'codigo';
const LOTE = 100;
const MODELO = MODELO_EMBED; // fonte única: scripts/rag/modelo.mjs (revisão d)

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
} catch (e) {
  console.error('FALHOU: ' + String(e && e.message ? e.message : e));
  process.exit(1);
}
