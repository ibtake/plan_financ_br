// Cálculo puro da Reserva de emergência (IMPR-004).
//
// today/current são injetados para o teste não depender do relógio real. As
// transações usam a mesma forma camelCase que o app entrega às ocorrências
// (type, amount, categoryId, date, recurrence).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeEmergencyReserve, RESERVE_CATEGORY_ID } from '../src/utils/emergencyReserve.js'

const AT = { today: '2026-09-07', current: '2026-09' }
const expense = (id, date, amount) => ({ id, date, amount, type: 'expense', categoryId: 'mercado' })
const aporte = (id, date, amount, extra = {}) => ({
  id,
  date,
  amount,
  type: 'reinvested',
  categoryId: RESERVE_CATEGORY_ID,
  ...extra,
})

test('burn-rate = média dos 3 meses fechados anteriores', () => {
  const txns = [expense('e1', '2026-08-10', 1000), expense('e2', '2026-07-10', 2000), expense('e3', '2026-06-10', 900)]
  assert.equal(computeEmergencyReserve(txns, {}, AT).burnRate, 1300)
})

test('burn-rate de quem começou agora divide só pelos meses com dado', () => {
  // Só agosto tem dado: divide por 1, não por 3 (senão a folga fica inflada).
  const r = computeEmergencyReserve([expense('e1', '2026-08-10', 1200)], {}, AT)
  assert.equal(r.burnRate, 1200)
})

test('saldo = base + aportes após a correção; ignora o próprio dia e o futuro', () => {
  const txns = [
    aporte('r0', '2026-07-01', 999), // no dia da base: a base já reflete → ignora
    aporte('r1', '2026-07-05', 5000), // depois da base → conta
    aporte('r2', '2026-09-30', 1000), // futuro (hoje 09-07) → ignora
  ]
  const r = computeEmergencyReserve(txns, { baselineAmount: 3000, baselineDate: '2026-07-01' }, AT)
  assert.equal(r.contributions, 5000)
  assert.equal(r.balance, 8000)
})

test('sem base, conta todos os aportes já ocorridos', () => {
  const txns = [aporte('r1', '2026-05-10', 2000), aporte('r2', '2026-08-01', 1000), aporte('r3', '2026-10-01', 500)]
  const r = computeEmergencyReserve(txns, {}, AT)
  assert.equal(r.balance, 3000)
})

test('aporte recorrente expande em cada mês (reuso do expandMonth)', () => {
  // Mensal a partir de 15/07 → jul, ago (set/15 é futuro em 09-07).
  const txns = [aporte('r', '2026-07-15', 500, { recurrence: 'monthly' })]
  assert.equal(computeEmergencyReserve(txns, {}, AT).balance, 1000)
})

test('meses de folga e progresso da meta', () => {
  const txns = [
    expense('e1', '2026-08-10', 1000),
    expense('e2', '2026-07-10', 2000),
    expense('e3', '2026-06-10', 900),
    aporte('r1', '2026-07-05', 5000),
  ]
  const r = computeEmergencyReserve(txns, { baselineAmount: 3000, baselineDate: '2026-07-01', targetMonths: 12 }, AT)
  assert.equal(r.balance, 8000)
  assert.ok(Math.abs(r.monthsOfSafety - 8000 / 1300) < 1e-9)
  assert.ok(Math.abs(r.progress - (8000 / 1300 / 12) * 100) < 1e-9)
})

test('progresso trava em 100 quando a folga passa da meta', () => {
  const txns = [expense('e1', '2026-08-10', 100), aporte('r1', '2026-07-05', 5000)]
  const r = computeEmergencyReserve(txns, { baselineDate: '2026-07-01', targetMonths: 3 }, AT)
  assert.equal(r.progress, 100)
})

test('gasto zero não divide: burn-rate 0, folga e progresso nulos', () => {
  // Agosto tem dado (um aporte) mas nenhuma despesa → média 0; não dá pra dividir.
  const r = computeEmergencyReserve([aporte('r1', '2026-08-05', 5000)], { targetMonths: 6 }, AT)
  assert.equal(r.burnRate, 0)
  assert.equal(r.monthsOfSafety, null)
  assert.equal(r.progress, null)
})

test('sem nenhum mês anterior com dado, burn-rate é nulo', () => {
  // Único lançamento no mês corrente: não há mês fechado anterior com dado.
  const r = computeEmergencyReserve([expense('e1', '2026-09-03', 800)], { targetMonths: 6 }, AT)
  assert.equal(r.burnRate, null)
  assert.equal(r.monthsOfSafety, null)
})

test('correção vencida quando a base tem 3+ meses de atraso', () => {
  assert.equal(computeEmergencyReserve([], { baselineDate: '2026-06-01' }, AT).needsCorrection, true) // 3 meses
  assert.equal(computeEmergencyReserve([], { baselineDate: '2026-07-01' }, AT).needsCorrection, false) // 2 meses
  assert.equal(computeEmergencyReserve([], {}, AT).needsCorrection, false) // sem base
})
