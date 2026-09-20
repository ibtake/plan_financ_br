import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toTxUpdateRow } from '../src/lib/financeTransforms.js'
import { isCurrentLoad } from '../src/lib/offlineRevalidation.js'

const tx = {
  id: 't1', type: 'expense', description: 'Aluguel', amount: 100, categoryId: 'moradia',
  date: '2026-09-01', method: 'pix', paid: true, recurrence: 'monthly', recurrenceEnd: '',
  installments: 1, tags: [], note: '', paidOccurrences: { 2: true }, createdAt: '2026-09-01T00:00:00Z',
}

// AUDT-020: paid_occurrences so a RPC gerencia; nunca sai no UPDATE colunar.
test('toTxUpdateRow nunca inclui paid_occurrences', () => {
  assert.equal('paid_occurrences' in toTxUpdateRow(tx, 'u1', 0), false)
  assert.equal('paid_occurrences' in toTxUpdateRow(tx, 'u1', 3), false)
})

// occ 0 = edicao da base, mantem paid (checkbox do form). occ > 0 = ocorrencia
// recorrente, a coluna base paid nao pertence a edicao.
test('paid so aparece na ocorrencia 0', () => {
  assert.equal('paid' in toTxUpdateRow(tx, 'u1', 0), true)
  assert.equal('paid' in toTxUpdateRow(tx, 'u1', 3), false)
})

// AUDT-020: mutacao confirmada durante a carga invalida o snapshot em voo.
test('isCurrentLoad invalida quando dataVersion mudou', () => {
  const base = { requestId: 1, userId: 'u1', sessionRevision: 0, dataVersion: 0 }
  assert.equal(isCurrentLoad(base, { ...base }), true)
  assert.equal(isCurrentLoad(base, { ...base, dataVersion: 1 }), false)
})

// Chamadas legadas sem dataVersion nos dois lados continuam validas.
test('dataVersion ausente nos dois lados e igual', () => {
  const base = { requestId: 1, userId: 'u1', sessionRevision: 0 }
  assert.equal(isCurrentLoad(base, { ...base }), true)
})
