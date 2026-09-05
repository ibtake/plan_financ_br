// TASK-005: o gate do Upstash duplica em JS limites que vivem no plpgsql e
// repete o mesmo helper em tres Edge Functions (deploy por colagem no painel
// proibe `_shared/`, backlog B34). Nenhuma das duas duplicacoes acusa erro ao
// divergir: numero menor no Redis nega antes da RPC, numero maior deixa o gate
// inutil, e uma copia do helper corrigida sozinha ainda passa no `deno check`.
// Este teste le os arquivos e compara.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8')
const schema = read('supabase/schema.sql')
const adminUsers = read('supabase/functions/admin-users/index.ts')
const widgetData = read('supabase/functions/widget-data/index.ts')
const widgetSetup = read('supabase/functions/widget-setup/index.ts')

// `case <coluna> when 'x' then N ... else N end`, uma linha do plpgsql.
function plpgsqlCase(marcador) {
  const linha = schema.split('\n').find((row) => row.includes(marcador))
  assert.ok(linha, `case de ${marcador} nao encontrado no schema.sql`)
  return {
    limites: Object.fromEntries([...linha.matchAll(/when '([^']+)' then (\d+)/g)].map(([, chave, valor]) => [chave, Number(valor)])),
    fallback: Number(linha.match(/else (\d+) end/)[1]),
  }
}

// Objeto literal de limites de uma function, chave entre aspas ou nua.
function tsLimits(source, nome) {
  const bloco = source.split(nome)[1].split('}')[0]
  return Object.fromEntries([...bloco.matchAll(/'?([\w-]+)'?\s*:\s*(\d+)/g)].map(([, chave, valor]) => [chave, Number(valor)]))
}

// Corpo do helper, do cabecalho ate a chave que fecha na coluna 1.
function helper(source) {
  const trecho = source.match(/async function consumeRedisLimit\([\s\S]*?\n}\n/)
  assert.ok(trecho, 'consumeRedisLimit nao encontrado')
  return trecho[0]
}

test('limites do gate administrativo batem com consume_admin_rate_limit', () => {
  const { limites, fallback } = plpgsqlCase('case p_action when')
  assert.deepEqual(tsLimits(adminUsers, 'ADMIN_REDIS_LIMITS'), limites)
  assert.ok(adminUsers.includes(`ADMIN_REDIS_LIMITS[action] ?? ${fallback}`), `fallback do gate diverge do else ${fallback} da RPC`)
  // Janela do gate contra o `interval` do on conflict da RPC.
  assert.ok(adminUsers.includes('consumeRedisLimit(`arl:${action}:${adminId}`, ADMIN_REDIS_LIMITS[action] ?? 60, 60)'))
  assert.ok(schema.includes("admin_action_rate_limits.window_started_at < now() - interval '1 minute'"))
})

test('limites do gate do widget batem com consume_widget_rate_limit', () => {
  const { limites, fallback } = plpgsqlCase('case p_operation when')
  // 'install' e o `else` do case, nao um `when`.
  assert.deepEqual(tsLimits(widgetData, 'REDIS_WIDGET_LIMITS'), { ...limites, install: fallback })
  assert.ok(widgetData.includes('consumeRedisLimit(`wrl:${operation}:${keyHash}`, REDIS_WIDGET_LIMITS[operation], 60)'))
  // widget-setup usa o limite de 'install' cru, sem o mapa.
  assert.ok(widgetSetup.includes(`consumeRedisLimit(\`wrl:install:\${installKeyHash}\`, ${fallback}, 60)`), `widget-setup diverge do limite ${fallback} de install`)
  assert.ok(schema.includes('v_window_seconds integer := 60;'))
})

test('teto global de tentativas invalidas bate com a RPC v40', () => {
  const limite = Number(schema.match(/v_limit constant integer := (\d+);/)[1])
  const janela = Number(schema.match(/v_window_seconds constant integer := (\d+);/)[1])
  assert.equal(limite, 600)
  assert.equal(janela, 3600)
  assert.ok(widgetData.includes(`consumeRedisLimit('wial', ${limite}, ${janela})`), 'gate global diverge da RPC v40')
})

test('as tres copias de consumeRedisLimit sao identicas', () => {
  assert.equal(helper(widgetData), helper(adminUsers))
  assert.equal(helper(widgetData), helper(widgetSetup))
})

test('gate opcional: sem segredo o helper devolve null antes de qualquer fetch', () => {
  const trecho = helper(widgetData)
  const guarda = trecho.indexOf('if (!base || !token) return null')
  assert.ok(guarda > 0, 'guarda de segredo ausente')
  assert.ok(guarda < trecho.indexOf('fetch('), 'guarda depois do fetch')
})
