// Cálculo puro da Reserva de emergência (IMPR-004).
//
// Reusa expandMonth (expansão de recorrências/parcelas) — a MESMA que alimenta
// os gráficos e o resumo do mês (useFinance.js) — para que o burn-rate case
// exatamente com o total de despesas que o app já mostra. Nada aqui toca em
// React nem no banco; `today`/`current` são injetáveis para teste determinístico.

import { expandMonth } from './recurrence.js'
import { addMonths, currentMonthKey, monthKeyFromDate, todayISO } from './format.js'

export const RESERVE_CATEGORY_ID = 'reserva-emergencia'

/** Meses de folga recomendados quando o usuário não definiu meta própria. */
export const SUGGESTED_MONTHS = 6

/** Total de despesas (type === 'expense') de um mês já expandido. */
function monthExpense(transactions, monthKey) {
  let total = 0
  for (const o of expandMonth(transactions, monthKey)) {
    if (o.type === 'expense') total += Number(o.amount) || 0
  }
  return total
}

/** Primeira competência com dado (menor AAAA-MM entre os lançamentos). */
function firstDataMonth(transactions) {
  let min = null
  for (const t of transactions) {
    const k = monthKeyFromDate(t.date)
    if (k && (min === null || k < min)) min = k
  }
  return min
}

/**
 * Deriva tudo que o card precisa a partir dos lançamentos e da linha de
 * emergency_reserve (baseline manual + meta de meses).
 *
 * - burnRate: média das despesas dos até 3 meses fechados anteriores ao atual
 *   que já têm dado (dividir por 3 fixo inflaria a folga de quem começou agora).
 * - balance: baseline + aportes na categoria posteriores à correção e já
 *   ocorridos (data > baseline_date, data <= hoje). Estritamente-após evita
 *   contar duas vezes uma correção feita no mesmo dia de um aporte.
 * - monthsOfSafety: balance / burnRate (null quando não há gasto para dividir).
 */
export function computeEmergencyReserve(
  transactions = [],
  { baselineAmount = 0, baselineDate = null, targetMonths = null } = {},
  { today = todayISO(), current = currentMonthKey() } = {},
) {
  const txns = Array.isArray(transactions) ? transactions : []

  const first = firstDataMonth(txns)
  const prevKeys = [addMonths(current, -1), addMonths(current, -2), addMonths(current, -3)].filter(
    (k) => first && k >= first,
  )
  const burnRate = prevKeys.length
    ? prevKeys.reduce((s, k) => s + monthExpense(txns, k), 0) / prevKeys.length
    : null

  const baseAmt = Number(baselineAmount) || 0
  const baseDay = baselineDate ? String(baselineDate).slice(0, 10) : null
  const startKey = baseDay ? monthKeyFromDate(baseDay) : first
  let contributions = 0
  if (startKey) {
    for (let k = startKey; k <= current; k = addMonths(k, 1)) {
      for (const o of expandMonth(txns, k)) {
        if (o.categoryId !== RESERVE_CATEGORY_ID) continue
        const d = String(o.date).slice(0, 10)
        if (d > today) continue // ocorrência ainda não aconteceu
        if (baseDay && d <= baseDay) continue // base já reflete a realidade até a data
        contributions += Number(o.amount) || 0
      }
    }
  }
  const balance = baseAmt + contributions

  const monthsOfSafety = burnRate && burnRate > 0 ? balance / burnRate : null
  const goal = targetMonths ? Number(targetMonths) : null
  const progress =
    goal && monthsOfSafety != null ? Math.min(100, (monthsOfSafety / goal) * 100) : null
  // Correção vencida: base com 3+ meses de atraso em relação ao mês corrente.
  const needsCorrection = Boolean(baseDay) && monthKeyFromDate(baseDay) <= addMonths(current, -3)

  return {
    balance,
    burnRate,
    monthsOfSafety,
    targetMonths: goal,
    progress,
    contributions,
    baselineAmount: baseAmt,
    baselineDate: baseDay,
    needsCorrection,
  }
}
