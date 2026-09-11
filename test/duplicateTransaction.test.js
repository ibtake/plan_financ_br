// Deteccao de lancamento duplicado no mes (IMPR-012).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDuplicateInMonth } from '../src/utils/duplicateTransaction.js'

const tx = (over) => ({ id: 'a', type: 'expense', description: 'Aluguel', amount: 1500, date: '2026-09-10', recurrence: 'none', installments: 1, ...over })

test('detecta duplicata no mesmo mes', () => {
  const found = findDuplicateInMonth({ description: 'Aluguel', amount: 1500, date: '2026-09-20' }, [tx()])
  assert.equal(found?.sourceId, 'a')
})

test('mesmo lancamento em mes diferente e ignorado', () => {
  assert.equal(findDuplicateInMonth({ description: 'Aluguel', amount: 1500, date: '2026-10-20' }, [tx()]), null)
})

test('edicao do proprio item e ignorada', () => {
  const found = findDuplicateInMonth({ id: 'a', sourceId: 'a', description: 'Aluguel', amount: 1500, date: '2026-09-10' }, [tx()])
  assert.equal(found, null)
})

test('sufixo (copia) casa com o original', () => {
  const found = findDuplicateInMonth({ description: 'Aluguel (cópia)', amount: 1500, date: '2026-09-15' }, [tx()])
  assert.equal(found?.sourceId, 'a')
})

test('descricao diferente nao casa', () => {
  assert.equal(findDuplicateInMonth({ description: 'Internet', amount: 1500, date: '2026-09-15' }, [tx()]), null)
})

test('valor diferente nao casa', () => {
  assert.equal(findDuplicateInMonth({ description: 'Aluguel', amount: 1200, date: '2026-09-15' }, [tx()]), null)
})
