// Transporte do RAG (v2.30, Nível 2): a fachada que isola o webhook do banco
// vetorial. Aqui se prende a ESCHA por env (RAG_TRANSPORTE) e o contrato das
// mensagens de erro — sem rede (a implementação Qdrant/Pinecone real só roda
// em produção; os testes da suíte não tocam API nenhuma).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transporteRag } from '../vercel+linear/api/rag-transporte.js';

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
