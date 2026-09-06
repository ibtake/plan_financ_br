import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRememberedAccounts, initialLoginStep } from '../src/lib/rememberedAccounts.js'

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

test('markPasskey seta a marca e remember cego a preserva', () => {
  const storage = memoryStorage()
  const contas = createRememberedAccounts({ storage })

  contas.remember('a@x.com')
  assert.equal(contas.list()[0].hasPasskey, false)

  assert.equal(contas.markPasskey('A@X.com'), true)
  assert.equal(contas.list()[0].hasPasskey, true)

  // authSession chama remember() cego a cada sessao: a marca nao pode sumir.
  contas.remember('a@x.com')
  assert.equal(contas.list()[0].hasPasskey, true)
})

test('list revalida hasPasskey do storage: so true booleano vira marca', () => {
  const storage = memoryStorage([
    { email: 'v@x.com', lastUsedAt: 3, hasPasskey: true },
    { email: 'f@x.com', lastUsedAt: 2, hasPasskey: 'true' },
    { email: 'n@x.com', lastUsedAt: 1 },
  ])
  const lista = createRememberedAccounts({ storage }).list()
  assert.equal(lista.find((i) => i.email === 'v@x.com').hasPasskey, true)
  assert.equal(lista.find((i) => i.email === 'f@x.com').hasPasskey, false)
  assert.equal(lista.find((i) => i.email === 'n@x.com').hasPasskey, false)
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

test('etapa inicial: conta unica abre na senha, duas ou mais na escolha', () => {
  assert.deepEqual(initialLoginStep([]), { mode: 'login', selected: null })
  assert.deepEqual(initialLoginStep([{ email: 'a@x.com' }]), { mode: 'login', selected: 'a@x.com' })
  assert.deepEqual(
    initialLoginStep([{ email: 'a@x.com' }, { email: 'b@x.com' }]),
    { mode: 'accounts', selected: null },
  )
})

test('etapa inicial casa com a lista real do storage', () => {
  const uma = createRememberedAccounts({ storage: memoryStorage([{ email: 'so@x.com', lastUsedAt: 5 }]) })
  assert.deepEqual(initialLoginStep(uma.list()), { mode: 'login', selected: 'so@x.com' })

  const nenhuma = createRememberedAccounts({ storage: memoryStorage() })
  assert.deepEqual(initialLoginStep(nenhuma.list()), { mode: 'login', selected: null })
})
