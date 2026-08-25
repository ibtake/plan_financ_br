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
  const [year, month, day] = String(isoDate).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function dayDiff(fromDate, toDate) {
  const toUtc = (value) => {
    const [year, month, day] = String(value).slice(0, 10).split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toUtc(toDate) - toUtc(fromDate)) / 86400000)
}

/**
 * A ocorrencia nesta data cai depois do fim da repeticao?
 *
 * Comparacao por DATA, espelhando o gate de widget-data/index.ts:110. Decidido no
 * B57: das duas semanticas de recurrenceEnd que divergiam, vale a do widget (por
 * data), nao a do app antigo (por mes). O slice(0,10) corta timestamp do banco.
 */
function afterRecurrenceEnd(tx, isoDate) {
  return Boolean(tx.recurrenceEnd && isoDate > String(tx.recurrenceEnd).slice(0, 10))
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
    const occ = isoDateInMonth(monthKey, dayOf(tx.date))
    if (afterRecurrenceEnd(tx, occ)) return []
    return [makeOccurrence(tx, index, occ, { installmentLabel: `${index + 1}/${installments}` })]
  }

  // Sem recorrencia: so aparece no proprio mes
  if (recurrence === 'none') {
    return monthKey === startKey ? [makeOccurrence(tx, 0, tx.date)] : []
  }

  // Semanal: varias ocorrencias dentro do mesmo mes
  if (recurrence === 'weekly') {
    const out = []
    const firstIndex = Math.max(0, Math.ceil(dayDiff(tx.date, `${monthKey}-01`) / 7))
    let index = firstIndex
    let cursor = addDays(tx.date, index * 7)
    while (monthKeyFromDate(cursor) === monthKey) {
      if (afterRecurrenceEnd(tx, cursor)) break
      out.push(makeOccurrence(tx, index, cursor))
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
  const occ = isoDateInMonth(monthKey, dayOf(tx.date))
  if (afterRecurrenceEnd(tx, occ)) return []
  const index = diff / step
  return [makeOccurrence(tx, index, occ)]
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

// Um render chama expandMonth 50 vezes, mas para 12 meses distintos (medido por
// instrumentacao). As tres fontes de repeticao: `yearPatrimony` reexpande meses
// que `history` acabou de expandir - a janela [jan..key] e sempre subconjunto dos
// 12 meses terminando em key -; o segundo `useMonthlyData` de `App.jsx` (`chartMonthly`)
// repete o primeiro inteiro sempre que o mes selecionado e o atual ou futuro
// (`chartMonthKey`); e `MonthlyChart.jsx` pede 3-6 meses que ja estao na janela de
// history. Medido com 2 000 lancamentos: 33 ms -> 9,7 ms por render. Reexpandir um
// mes custa ~580 µs; os 38 hits que este memo economiza custam 6 µs somados.
//
// A chave e a IDENTIDADE do array. Isso e seguro porque `useSupabaseFinance` nunca
// altera `transactions` no lugar - toda escrita cria um array novo (`[tx, ...prev]`
// em addTransaction, `prev.map` em updateTransaction/togglePaid/deleteCategory,
// `prev.filter` em deleteTransaction, um `.map` novo na carga inicial) -, entao o
// WeakMap perde a entrada e o cache esfria junto com o dado. Se algum dia alguem
// mutar o array existente, este cache passa a servir dado velho:
// e o unico invariante que ele exige.
const monthCache = new WeakMap()

/** Todas as ocorrencias de todos os lancamentos em um mes */
export function expandMonth(transactions, monthKey) {
  let byMonth = monthCache.get(transactions)
  if (!byMonth) {
    byMonth = new Map()
    monthCache.set(transactions, byMonth)
  }

  // `slice` em vez do array guardado: cada chamador recebe o seu, entao um
  // `.sort()` no resultado nao reordena o de outro consumidor. Nenhum faz isso
  // hoje (todos ordenam um `.filter()`), mas custa µs contra ~600 µs de
  // reexpansao e dispensa o invariante. Os objetos de ocorrencia seguem
  // compartilhados - nao escreva neles.
  const cached = byMonth.get(monthKey)
  if (cached) return cached.slice()

  const out = []
  for (const tx of transactions) {
    out.push(...occurrencesInMonth(tx, monthKey))
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  byMonth.set(monthKey, out)
  return out.slice()
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

/**
 * Um lancamento se repete (recorrente ou parcelado)?
 *
 * O Boolean() nao e decoracao: sem ele o `&&` final vazava o operando e a
 * funcao devolvia `undefined` quando `recurrence` era ausente (o formulario
 * omite o campo no avulso). Os dois consumidores tratam por truthiness e nao
 * mudam de comportamento - o filtro de FixedExpenses.jsx:12 e o confirm de
 * App.jsx:194 -, mas a JSDoc pergunta sim/nao e agora e sim/nao (B46).
 */
export function isRecurring(tx) {
  return Boolean((Number(tx.installments) || 1) > 1 || (tx.recurrence && tx.recurrence !== 'none'))
}

/**
 * Fim de repeticao anterior a data do lancamento?
 *
 * A regra e BARRAR, decidida pelo usuario em 24/08/2026 - nao descartar o fim
 * nem corrigi-lo para a data de inicio. Motivo: `occurrencesInMonth` descarta
 * (via `afterRecurrenceEnd`) toda ocorrencia posterior ao fim, e a propria data
 * de inicio ja e posterior a um fim invertido, entao a serie zera em TODOS os
 * meses, inclusive o proprio. O lancamento
 * era gravado sem erro e nao aparecia em lista nenhuma; como FixedExpenses:12,
 * Insights:82 e TransactionList:155 consomem `occurrences`, nao havia nem como
 * apaga-lo pela interface. O banco tambem nao segura: `transactions_date_range`
 * (schema.sql:696) so limita 1970-2200 e nada cruza os dois campos.
 *
 * Vive aqui, e nao no formulario, porque dois caminhos aplicam a mesma regra -
 * `TransactionForm.jsx:96` no submit e `useSupabaseFinance.js:625` no import de
 * backup - e duas copias divergiriam. Campo vazio de um dos lados nao e
 * invalido: sem inicio a comparacao nao significa nada e `occurrencesInMonth`
 * ja devolve [] por `!startKey`; sem fim a serie e infinita, que e valido (B41).
 */
export function recurrenceEndBeforeStart(tx) {
  const inicio = String(tx?.date || '').slice(0, 10)
  const fim = String(tx?.recurrenceEnd || '').slice(0, 10)
  return Boolean(inicio && fim && fim < inicio)
}

/** Mensagem unica da regra acima - formulario e import dizem a mesma coisa. */
export const RECURRENCE_END_ERROR = 'A data de repetição não pode ser inferior à data do lançamento.'
