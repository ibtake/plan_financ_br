// AUDT-013: o gate de migrations so avisa, nunca falha, entao sem este teste as
// duas regressoes possiveis passariam em silencio - o strip de comentario
// voltando a acusar prosa e o parser do indice reconhecendo metade da tabela
// (a versao com [^|] engolia a quebra de linha e perdia as linhas alternadas).
// Roda o validador de verdade: cobre o texto do README junto com o codigo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// O validador resolve `supabase/migrations` a partir do cwd, entao o cwd vem da
// raiz do projeto e nao de onde o runner foi invocado.
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const result = spawnSync(process.execPath, ['scripts/validate-migrations.mjs'], { cwd: projectRoot, encoding: 'utf8' })
const output = `${result.stdout}${result.stderr}`

test('nenhum erro de nome ou timestamp nas migrations', () => {
  assert.equal(result.status, 0, output)
})

test('as 42 migrations tem objetivo documentado, no cabecalho ou no indice do README', () => {
  assert.ok(!output.includes('documente o objetivo'), output)
})

test('operacao de risco real continua visivel', () => {
  assert.match(output, /v25_atomic_widget_install\.sql: contem SET NOT NULL/)
})

test('palavra-chave de risco dentro de comentario nao gera aviso', () => {
  assert.ok(!output.includes('v41_sec02_goals_least_privilege.sql: contem TRUNCATE'), output)
})
