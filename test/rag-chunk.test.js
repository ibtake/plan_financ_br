// Chunker da fase 2 do RAG (D2 do design-rag-fase0.md): allowlist, unidades
// por símbolo top-level, teto com janelas e payload mínimo do contrato 2.1.
// O corpo do código não vai para o Qdrant (só a localização), então o que se
// prende aqui é o contrato do cartão e a fronteira da allowlist — a camada
// (a) da D3 (segredo não entra no índice) depende exatamente desta fronteira.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { caminhoElegivel, unidadesDe, estimarTokens, chunkRepositorio } from '../scripts/rag/chunk.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('caminhoElegivel aceita exatamente a allowlist da D2', () => {
  // Os 4 padrões do inventário real de 2026-08-31, um por família.
  for (const caminho of [
    'src/utils/format.js',
    'src/components/CartaoMeta.jsx',
    'test/format.test.js',
    'vercel+linear/api/linear-webhook.js',
    'supabase/functions/analise-mensal/index.ts',
  ]) {
    assert.ok(caminhoElegivel(caminho), `deveria aceitar ${caminho}`)
  }
})

test('caminhoElegivel barra exclusões duras e pastas fora da allowlist', () => {
  for (const caminho of [
    'scripts/linear-key.mjs', // tooling de dev (D2 exclui scripts/)
    'docs/PADRAO-LINEAR.md', // documentação
    'supabase/migrations/20260101000000_x.sql', // migrations
    'supabase/functions/analise-mensal/deno.json', // só index.ts entra
    'src/.env.js', // dotfile de ambiente
    'src/x.__backup__.jsx', // backup de editor
    'app/main.jsx', // pasta fora da allowlist
    'dist/assets/index.js', // artefato de build
  ]) {
    assert.equal(caminhoElegivel(caminho), null, `deveria barrar ${caminho}`)
  }
})

test('unidadesDe pega símbolos top-level e deixa função interna na unidade pai', () => {
  // Scan leve por decisão da D2: regex ancorada na coluna 0. A função interna
  // "interna" é indentada e por isso pertence a "soma", não vira unidade.
  const fonte = [
    'const LIMITE = 10',
    'function soma(a, b) {',
    '  function interna(x) { return x + 1 }',
    '  return interna(a) + b',
    '}',
    'const sub = (a, b) => {',
    '  return a - b',
    '}',
    'export class Calc {',
    '  dobrar() { return 2 }',
    '}',
  ].join('\n')
  const { unidades } = unidadesDe(fonte)
  assert.deepEqual(unidades.map((u) => u.simbolo), ['modulo', 'soma', 'sub', 'Calc'])
  assert.deepEqual(unidades.map((u) => u.inicio), [0, 1, 5, 8])
  assert.equal(unidades[1].fim, 4)
  assert.equal(unidades[3].fim, 10)
})

test('unidadesDe devolve o módulo inteiro quando não há símbolo top-level', () => {
  // Arquivo de constantes não pode sumir do índice: vira uma unidade única.
  const { unidades } = unidadesDe('export const CONFIG = { a: 1 }\n')
  assert.equal(unidades.length, 1)
  assert.equal(unidades[0].simbolo, 'modulo')
  assert.equal(unidades[0].inicio, 0)
})

test('arquivo vazio não produz unidade', () => {
  const { unidades } = unidadesDe('')
  assert.equal(unidades.length, 0)
})

test('estimarTokens segue a aproximação chars/4 do teto da D2', () => {
  assert.equal(estimarTokens('abcd'.repeat(100)), 100)
  assert.equal(estimarTokens('abc'), 1)
})

// Integração com a árvore real: a asserção da D2 (nenhum chunk fora da
// allowlist) vive dentro de chunkRepositorio e falha alto se furar; aqui se
// prende o volume, os 8 campos do contrato 2.1 e a determinística do id
// (re-indexar não pode duplicar ponto — mesma propriedade do UUID v5 da D7).
test('chunkRepositorio produz chunks com payload do contrato 2.1 e ids determinísticos', () => {
  const chunks = chunkRepositorio(RAIZ)
  assert.ok(chunks.length > 50, `poucos chunks na árvore real: ${chunks.length}`)

  const campos = ['repo', 'path', 'inicio', 'fim', 'simbolo', 'sha_arquivo', 'data_commit', 'linguagem']
  for (const chunk of chunks) {
    for (const campo of campos) {
      assert.ok(campo in chunk.payload, `payload de ${chunk.payload.path} sem ${campo}`)
    }
    assert.equal(chunk.payload.repo, 'local/planejador') // fora do Actions
    // Qdrant só aceita id inteiro sem sinal ou UUID (upsert.mjs confia nisso).
    assert.match(chunk.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.ok(Number.isInteger(chunk.payload.inicio) && chunk.payload.inicio >= 1)
    assert.ok(chunk.payload.fim >= chunk.payload.inicio)
    // includes e não regex: "vercel+linear" tem "+", que é quantificador.
    assert.ok(chunk.text.includes(`caminho: ${chunk.payload.path}`))
  }

  const deNovo = chunkRepositorio(RAIZ)
  assert.deepEqual(deNovo.map((c) => c.id), chunks.map((c) => c.id))
})
