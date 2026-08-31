/**
 * Upsert da coleção `codigo` no Qdrant (fase 2; design-rag-fase0.md, D2 + D6).
 *
 * Entrada: pontos.json produzido pelo embed.py — [{ id, vector, payload }],
 * id já UUID v5 determinístico do chunker.
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
 * Uso: node scripts/rag/upsert.mjs <pontos.json>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const DIM = 384;
const LOTE = 100;

async function qdrant(metodo, caminho, corpo) {
  const resp = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    // Corpo de resposta não contém a chave (ela vai só no header da request).
    throw new Error(`${metodo} ${caminho} → HTTP ${resp.status}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : {};
}

const pontos = await (async () => {
  try {
    return JSON.parse(readFileSync(resolve(arquivo), 'utf8'));
  } catch (e) {
    console.error('FALHOU: não consegui ler/parsing ' + arquivo + ' — ' + String(e.message || e));
    process.exit(1);
  }
})();
if (!Array.isArray(pontos) || !pontos.length) {
  console.error('FALHOU: pontos.json vazio ou inválido');
  process.exit(1);
}
for (const p of pontos) {
  if (!p.id || !Array.isArray(p.vector) || p.vector.length !== DIM || !p.payload?.path) {
    console.error(`FALHOU: ponto ${p.id || '?'} inválido (vetor ${DIM}d + payload.path obrigatórios)`);
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

  for (let i = 0; i < pontos.length; i += LOTE) {
    const lote = pontos
      .slice(i, i + LOTE)
      .map((p) => ({ id: p.id, vector: p.vector, payload: p.payload }));
    await qdrant('PUT', `/collections/${COLECAO}/points?wait=true`, { points: lote });
    console.log(`upsert: ${Math.min(i + LOTE, pontos.length)}/${pontos.length}`);
  }

  // O Qdrant embrulha a resposta em "result": { result: { count: N }, status }.
  // (3º run do reindex-rag: ler contagem.count direto dava undefined.)
  const contagem = await qdrant('POST', `/collections/${COLECAO}/points/count`, {
    exact: true,
    filter: { must: [{ key: 'repo', match: { value: REPO } }] },
  });
  const contados = contagem?.result?.count ?? contagem?.count;
  if (contados !== pontos.length) {
    throw new Error(
      `verificação falhou: ${contados} pontos de ${REPO} em ${COLECAO}, esperado ${pontos.length}`
    );
  }
  console.log(`OK: ${COLECAO} com ${contados} pontos de ${REPO}`);
} catch (e) {
  console.error('FALHOU: ' + String(e && e.message ? e.message : e));
  process.exit(1);
}
