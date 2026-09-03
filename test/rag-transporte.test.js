// Transporte do RAG (v2.30, Nível 2): a fachada que isola o webhook do banco
// vetorial. Aqui se prende a ESCHA por env (RAG_TRANSPORTE) e o contrato das
// mensagens de erro — sem rede (a implementação Qdrant/Pinecone real só roda
// em produção; os testes da suíte não tocam API nenhuma).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transporteRag, idMemoria } from '../vercel+linear/api/rag-transporte.js';

test('idMemoria: uuidV5 determinístico no Qdrant — paridade com o backfill da fase 4', () => {
  // Mesmo id que scripts/rag/backfill-memorias.mjs gera para o mesmo card:
  // namespace 'planejador-rag:v1' + "memoria:<card_id>". Se um dia mudar
  // namespace, a paridade quebra AQUI antes de duplicar pontos em produção.
  const a = idMemoria('BUG-003');
  const b = idMemoria('BUG-003');
  assert.equal(a, b); // determinístico
  assert.notEqual(a, idMemoria('BUG-004')); // distinto por card
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // UUID v5
});

test('idMemoria (IMPR-008): Pinecone usa STRING legível "memoria:<card_id>" — mesma chave do backfill adaptado', () => {
  const id = idMemoria('IMPR-006', { RAG_TRANSPORTE: 'pinecone' });
  assert.equal(id, 'memoria:IMPR-006'); // legível e debugável
  assert.notEqual(id, idMemoria('IMPR-006')); // difere do uuidV5 do Qdrant
  // sem env = default qdrant (uuidV5 — paridade com a fase 4)
  assert.match(idMemoria('IMPR-006', {}), /^[0-9a-f-]{36}$/);
});

test('transporteRag: default é qdrant', () => {
  const t = transporteRag({});
  assert.equal(t.nome, 'qdrant');
  assert.equal(typeof t.buscar, 'function');
  assert.equal(typeof t.upsertMemoria, 'function');
  assert.equal(typeof t.idMemoria, 'function');
});

test('transporteRag: env explícita qdrant respeitada (case-insensitive, com espaços)', () => {
  assert.equal(transporteRag({ RAG_TRANSPORTE: 'qdrant' }).nome, 'qdrant');
  assert.equal(transporteRag({ RAG_TRANSPORTE: ' Qdrant ' }).nome, 'qdrant');
});

test('transporteRag: pinecone ativo com buscar/upsert — sem env falha fechado ANTES de tocar a rede', async () => {
  const t = transporteRag({ RAG_TRANSPORTE: 'pinecone' });
  assert.equal(t.nome, 'pinecone');
  // Sem PINECONE_INDEX_HOST/API_KEY: erro descritivo imediato (não fetch de rede)
  await assert.rejects(() => t.buscar('codigo', 'consulta'), /pinecone: sem PINECONE_INDEX_HOST/);
  await assert.rejects(
    () => t.upsertMemoria('decisoes_arquitetura', { card_id: 'X', texto_entrada: 'y' }),
    /pinecone: sem PINECONE_INDEX_HOST/
  );
  // id string do transporte pinecone
  assert.equal(t.idMemoria('TASK-002'), 'memoria:TASK-002');
});

test('transporteRag: valor desconhecido é erro imediato com dica', () => {
  assert.throws(
    () => transporteRag({ RAG_TRANSPORTE: 'weaviate' }),
    /RAG_TRANSPORTE desconhecido "weaviate" \(use qdrant ou pinecone\)/
  );
});
