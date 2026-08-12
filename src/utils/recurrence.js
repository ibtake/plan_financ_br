// Expansao de lancamentos recorrentes e parcelados em ocorrencias virtuais.
//
// Um lancamento e guardado uma unica vez. As repeticoes sao geradas sob demanda
// para o mes consultado, com ids deterministicos ("<id>#<n>"), de modo que o
// status de pago/pendente de cada ocorrencia possa ser rastreado separadamente.

import { monthKeyFromDate, isoDateInMonth, parseMonthKey } from './format.js'

/** Quantos meses cada tipo de recorrencia avanca por repeticao */
const MONTH_STEP = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  yearly: 12,
}

/** Diferenca em meses entre duas chaves "AAAA-MM" */
function monthDiff(fromKey, toKey) {
  const a = parseMonthKey(fromKey)
  const b = parseMonthKey(toKey)
  return (b.year - a.year) * 12 + (b.month - a.month)
}

/** Numero do dia de uma data ISO */
function dayOf(isoDate) {
  return Number(String(isoDate).slice(8, 10)) || 1
}

/** Soma dias a uma data ISO */
function addDays(isoDate, days) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`)
  d.setDate(d.getDate() + days)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/**
 * Ocorrencias de um lancamento dentro de um mes especifico.
 * Retorna [] se o lancamento nao acontece nesse mes.
 */
function occurrencesInMonth(tx, monthKey) {
  const startKey = monthKeyFromDate(tx.date)
  if (!startKey || monthKey < startKey) return []

  const installments = Number(tx.installments) || 1
  const recurrence = tx.recurrence || 'none'

  // Parcelamento: uma parcela por mes a partir da data inicial
  if (installments > 1) {
    const index = monthDiff(startKey, monthKey)
    if (index < 0 || index >= installments) return []
    return [
      makeOccurrence(tx, index, isoDateInMonth(monthKey, dayOf(tx.date)), {
        installmentLabel: `${index + 1}/${installments}`,
      }),
    ]
  }

  // Sem recorrencia: so aparece no proprio mes
  if (recurrence === 'none') {
    return monthKey === startKey ? [makeOccurrence(tx, 0, tx.date)] : []
  }

  // Recorrencia encerrada?
  if (tx.recurrenceEnd && monthKey > monthKeyFromDate(tx.recurrenceEnd)) return []

  // Semanal: varias ocorrencias dentro do mesmo mes
  if (recurrence === 'weekly') {
    const out = []
    let cursor = tx.date
    let index = 0
    // limite de seguranca: 5 anos de semanas
    while (monthKeyFromDate(cursor) <= monthKey && index < 260) {
      if (monthKeyFromDate(cursor) === monthKey) {
        if (tx.recurrenceEnd && cursor > tx.recurrenceEnd) break
        out.push(makeOccurrence(tx, index, cursor))
      }
      cursor = addDays(cursor, 7)
      index++
    }
    return out
  }

  // Mensal / bimestral / trimestral / anual
  const step = MONTH_STEP[recurrence]
  if (!step) return []
  const diff = monthDiff(startKey, monthKey)
  if (diff < 0 || diff % step !== 0) return []
  const index = diff / step
  return [makeOccurrence(tx, index, isoDateInMonth(monthKey, dayOf(tx.date)))]
}

function makeOccurrence(tx, index, date, extra = {}) {
  return {
    ...tx,
    ...extra,
    id: index === 0 ? tx.id : `${tx.id}#${index}`,
    sourceId: tx.id,
    occurrenceIndex: index,
    date,
    isRepeat: index > 0,
    // Ocorrencias repetidas usam o mapa de status por ocorrencia
    paid: index === 0 ? tx.paid !== false : Boolean(tx.paidOccurrences?.[index]),
  }
}

/** Todas as ocorrencias de todos os lancamentos em um mes */
export function expandMonth(transactions, monthKey) {
  const out = []
  for (const tx of transactions) {
    out.push(...occurrencesInMonth(tx, monthKey))
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** Ocorrencias agregadas de varios meses (para graficos de evolucao) */
/** Texto amigavel da recorrencia de um lancamento */
export function recurrenceLabel(tx) {
  const installments = Number(tx.installments) || 1
  if (installments > 1) return `${installments}x parcelado`
  switch (tx.recurrence) {
    case 'weekly':
      return 'Semanal'
    case 'monthly':
      return 'Mensal'
    case 'bimonthly':
      return 'Bimestral'
    case 'quarterly':
      return 'Trimestral'
    case 'yearly':
      return 'Anual'
    default:
      return ''
  }
}

/** Um lancamento se repete (recorrente ou parcelado)? */
export function isRecurring(tx) {
  return (Number(tx.installments) || 1) > 1 || (tx.recurrence && tx.recurrence !== 'none')
}
