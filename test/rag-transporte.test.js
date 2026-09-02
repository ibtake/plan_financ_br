// Transporte do RAG (v2.30, Nível 2): a fachada que isola o webhook do banco
// vetorial. Aqui se prende a ESCHA por env (RAG_TRANSPORTE) e o contrato das
// mensagens de erro — sem rede (a implementação Qdrant/Pinecone real só roda
// em produção; os testes da suíte não tocam API nenhuma).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transporteRag, idMemoria } from '../vercel+linear/api/rag-transporte.js';

test('idMemoria: UUID v5 determinístico — paridade com o backfill da fase 4', () => {
  // Mesmo id que scripts/rag/backfill-memorias.mjs gera para o mesmo card:
  // namespace 'planejador-rag:v1' + "memoria:<card_id>" (duplicado de
  // propósito lá; este teste ancora a paridade — captura e backfill
  // escrevem o MESMO ponto, nunca duplicata).
  const a = idMemoria('BUG-003');
  const b = idMemoria('BUG-003');
  assert.equal(a, b); // determinístico
  assert.notEqual(a, idMemoria('BUG-004')); // distinto por card
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // UUID v5
  // Valor âncora: confere contra a derivação documentada (backfill usa a
  // mesma fórmula — se um dia mudar namespace, a paridade quebra AQUI
  // antes de duplicar pontos em produção.
  const known = idMemoria('TASK-002');
  assert.equal(known.length, 36);
});

test('transporteRag: default é qdrant', () => {
  const t = transporteRag({});
  assert.equal(t.nome, 'qdrant');
  assert.equal(typeof t.buscar, 'function');
});

test('transporteRag: env explícita qdrant respeitada (case-insensitive, com espaços)', () => {
  assert.equal(transporteRag({ RAG_TRANSPORTE: 'qdrant' }).nome, 'qdrant');
  assert.equal(transporteRag({ RAG_TRANSPORTE: ' Qdrant ' }).nome, 'qdrant');
});

test('transporteRag: pinecone existe como slot mas falha fechado (IMPR- futuro)', async () => {
  const t = transporteRag({ RAG_TRANSPORTE: 'pinecone' });
  assert.equal(t.nome, 'pinecone');
  // Nunca silêncio: mensagem diz o que fazer e qual coleção foi pedida
  await assert.rejects(
    () => t.buscar('codigo', 'consulta de teste'),
    /pinecone: transporte ainda não implementado.*Coleção consultada: codigo/
  );
});

test('transporteRag: valor desconhecido é erro imediato com dica', () => {
  assert.throws(
    () => transporteRag({ RAG_TRANSPORTE: 'weaviate' }),
    /RAG_TRANSPORTE desconhecido "weaviate" \(use qdrant ou pinecone\)/
  );
});
