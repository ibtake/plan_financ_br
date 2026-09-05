import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRememberedAccounts } from '../src/lib/rememberedAccounts.js'

const KEY = 'planejador:remembered-accounts'

function memoryStorage(initial) {
  const values = new Map(initial ? [[KEY, JSON.stringify(initial)]] : [])
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    raw: () => values.get(KEY),
  }
}

function emails(accounts) {
  return accounts.map((item) => item.email)
}

test('remember grava a conta e list devolve o e-mail normalizado', () => {
  const storage = memoryStorage()
  const contas = createRememberedAccounts({ storage })

  assert.equal(contas.remember('  Igor@Exemplo.COM '), true)
  assert.deepEqual(emails(contas.list()), ['igor@exemplo.com'])
  assert.ok(contas.list()[0].lastUsedAt > 0)
})

test('remember nao duplica a mesma conta e a promove para a frente', () => {
  const storage = memoryStorage()
  const contas = createRememberedAccounts({ storage })

  contas.remember('a@x.com')
  contas.remember('b@x.com')
  contas.remember('A@X.com')

  assert.deepEqual(emails(contas.list()), ['a@x.com', 'b@x.com'])
})

test('a lista para em 5 contas e descarta a mais antiga', () => {
  const storage = memoryStorage()
  const contas = createRememberedAccounts({ storage })

  for (const n of [1, 2, 3, 4, 5, 6]) contas.remember(`c${n}@x.com`)

  assert.deepEqual(emails(contas.list()), ['c6@x.com', 'c5@x.com', 'c4@x.com', 'c3@x.com', 'c2@x.com'])
})

test('list ordena pelo acesso mais recente', () => {
  const storage = memoryStorage([
    { email: 'antiga@x.com', lastUsedAt: 10 },
    { email: 'recente@x.com', lastUsedAt: 300 },
    { email: 'media@x.com', lastUsedAt: 200 },
  ])

  assert.deepEqual(
    emails(createRememberedAccounts({ storage }).list()),
    ['recente@x.com', 'media@x.com', 'antiga@x.com'],
  )
})

test('forget remove a conta, ignorando a caixa', () => {
  const storage = memoryStorage()
  const contas = createRememberedAccounts({ storage })

  contas.remember('a@x.com')
  contas.remember('b@x.com')

  assert.equal(contas.forget('A@X.COM'), true)
  assert.deepEqual(emails(contas.list()), ['b@x.com'])
})

test('registro corrompido no storage e descartado sem lancar', () => {
  for (const bruto of ['{}', '[', 'null', '"texto"', '[{"email":"sem-arroba"},{"email":null},7]']) {
    const storage = memoryStorage()
    storage.setItem(KEY, bruto)
    assert.deepEqual(createRememberedAccounts({ storage }).list(), [], `entrada: ${bruto}`)
  }
})

test('duplicata gravada a mao sobrevive uma unica vez, na entrada mais recente', () => {
  const storage = memoryStorage([
    { email: 'a@x.com', lastUsedAt: 1 },
    { email: 'A@x.com', lastUsedAt: 900 },
  ])

  const lista = createRememberedAccounts({ storage }).list()
  assert.deepEqual(emails(lista), ['a@x.com'])
  assert.equal(lista[0].lastUsedAt, 900)
})

test('remember recusa e-mail invalido sem tocar no storage', () => {
  const storage = memoryStorage()
  const contas = createRememberedAccounts({ storage })

  for (const invalido of ['', '   ', null, undefined, 'sem-arroba', 42]) {
    assert.equal(contas.remember(invalido), false, `entrada: ${String(invalido)}`)
  }
  assert.equal(storage.raw(), undefined)
})

test('storage indisponivel nao quebra o login', () => {
  const contas = createRememberedAccounts({ storage: null })

  assert.deepEqual(contas.list(), [])
  assert.equal(contas.remember('a@x.com'), false)
  assert.equal(contas.forget('a@x.com'), false)
})

test('storage que estoura a cota devolve false em vez de lancar', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }

  assert.equal(createRememberedAccounts({ storage }).remember('a@x.com'), false)
})
