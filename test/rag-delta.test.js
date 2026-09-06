// Delta do reindex (TASK-009): fingerprint determinístico e cálculo puro do
// delta entre o estado desejado (chunks do repo) e o armazenado no índice.
// Zero rede — módulo puro por desenho (scripts/rag/delta.mjs).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fingerprintDe, calcularDelta } from '../scripts/rag/delta.mjs'

test('fingerprintDe é determinístico e de 64 hex (sha256)', () => {
  const a = fingerprintDe('caminho: src/x.js | símbolo: x', 'abc123')
  const b = fingerprintDe('caminho: src/x.js | símbolo: x', 'abc123')
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('fingerprintDe muda quando o texto muda E quando o sha do arquivo muda', () => {
  const base = fingerprintDe('texto do cartão', 'sha1')
  // Texto diferente, mesmo sha: fingerprint diferente (cartão re-embedado).
  assert.notEqual(base, fingerprintDe('texto do cartão 2', 'sha1'))
  // Mesmo texto, sha diferente: fingerprint diferente — O SHA ENTRA NO HASH
  // DE PROPÓSITO: corpo do arquivo mudou com cartão idêntico teria sha velho
  // no payload e o webhook descartaria o trecho ("sha divergente").
  assert.notEqual(base, fingerprintDe('texto do cartão', 'sha2'))
})

test('fingerprintDe tolera ausência de sha (workspace sem git)', () => {
  assert.equal(fingerprintDe('x', undefined), fingerprintDe('x', ''))
  assert.match(fingerprintDe('x', ''), /^[0-9a-f]{64}$/)
})

// Helpers de teste: chunks com id do TRANSPORTE (Pinecone: string legível)
// — o chamador resolve o id antes de chamar calcularDelta.
function chunkDe(id, texto, sha) {
  return { id, text: texto, payload: { sha_arquivo: sha } }
}

test('calcularDelta: chunk novo vai para aUpsertar', () => {
  const delta = calcularDelta([chunkDe('a', 't1', 's1')], new Map())
  assert.deepEqual(delta.aUpsertar.map((c) => c.id), ['a'])
  assert.deepEqual(delta.aDeletar, [])
  assert.equal(delta.inalterados, 0)
})

test('calcularDelta: fingerprint igual é inalterado, diferente vai para aUpsertar', () => {
  const existentes = new Map([
    ['igual', fingerprintDe('t1', 's1')],
    ['mudou', fingerprintDe('velho', 's2')],
  ])
  const delta = calcularDelta(
    [chunkDe('igual', 't1', 's1'), chunkDe('mudou', 'novo', 's2')],
    existentes
  )
  assert.deepEqual(delta.aUpsertar.map((c) => c.id), ['mudou'])
  assert.equal(delta.inalterados, 1)
  assert.deepEqual(delta.aDeletar, [])
})

test('calcularDelta: id presente no índice e ausente da árvore é obsoleto', () => {
  const delta = calcularDelta([chunkDe('vivo', 't', 's')], new Map([['morto', 'f'], ['vivo', fingerprintDe('t', 's')]]))
  assert.deepEqual(delta.aUpsertar.map((c) => c.id), [])
  assert.deepEqual(delta.aDeletar, ['morto'])
  assert.equal(delta.inalterados, 1)
})

test('calcularDelta: fingerprint vazio/ausente no índice = re-embed (first run)', () => {
  const existentes = new Map([
    ['sem-fp', ''], // record no formato antigo (pré-TASK-009)
    ['com-fp', fingerprintDe('t1', 's1')],
  ])
  const delta = calcularDelta([chunkDe('sem-fp', 't1', 's1'), chunkDe('com-fp', 't1', 's1')], existentes)
  assert.deepEqual(delta.aUpsertar.map((c) => c.id), ['sem-fp'])
  assert.equal(delta.inalterados, 1)
})

test('calcularDelta aceita objeto simples além de Map (entrada defensiva)', () => {
  const delta = calcularDelta(
    [chunkDe('a', 't1', 's1')],
    { a: fingerprintDe('t1', 's1'), b: 'velho' }
  )
  assert.deepEqual(delta.aUpsertar.map((c) => c.id), [])
  assert.deepEqual(delta.aDeletar, ['b'])
  assert.equal(delta.inalterados, 1)
})
