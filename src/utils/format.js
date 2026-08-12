// Formatacao de moeda, datas e numeros (pt-BR)

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const PRIVATE_CURRENCY = 'R$ •••••'
const PRIVATE_NUMBER = '•••••'
const PRIVATE_PERCENT = '•••%'

function formatBrl(value, formatter) {
  const n = Number(value) || 0
  const formatted = formatter.format(Math.abs(n))
  return n < 0 ? formatted.replace(/^R\$\s*/, 'R$ -') : formatted
}

function valuesAreHidden() {
  return typeof document !== 'undefined' && document.documentElement.dataset.privacy === 'hidden'
}

export function formatCurrency(value) {
  if (valuesAreHidden()) return PRIVATE_CURRENCY
  return formatBrl(value, brl)
}

export function formatCompact(value) {
  if (valuesAreHidden()) return PRIVATE_CURRENCY
  const n = Number(value) || 0
  if (Math.abs(n) < 1000) return formatBrl(n, brl)
  return formatBrl(n, brlCompact)
}

export function formatPercent(value, digits = 0) {
  if (valuesAreHidden()) return PRIVATE_PERCENT
  const n = Number(value) || 0
  return `${n.toFixed(digits).replace('.', ',')}%`
}

// ---------- Datas ----------

export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

export const MONTH_SHORT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
]

/** Retorna a chave "AAAA-MM" de uma data ISO (AAAA-MM-DD) */
export function monthKeyFromDate(isoDate) {
  if (!isoDate) return ''
  return String(isoDate).slice(0, 7)
}

/** Monta a chave "AAAA-MM" a partir de ano e mes (0-11) */
export function makeMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

/** Converte "AAAA-MM" em { year, month } (month 0-11) */
export function parseMonthKey(key) {
  const [y, m] = String(key).split('-')
  return { year: Number(y), month: Number(m) - 1 }
}

/** Rotulo amigavel: "Março 2026" */
export function monthLabel(key) {
  const { year, month } = parseMonthKey(key)
  if (Number.isNaN(year) || Number.isNaN(month)) return ''
  return `${MONTH_NAMES[month]} ${year}`
}

/** Rotulo curto: "Mar/26" */
export function monthLabelShort(key) {
  const { year, month } = parseMonthKey(key)
  if (Number.isNaN(year) || Number.isNaN(month)) return ''
  return `${MONTH_SHORT[month]}/${String(year).slice(2)}`
}

/** Soma (ou subtrai) meses de uma chave "AAAA-MM" */
export function addMonths(key, delta) {
  const { year, month } = parseMonthKey(key)
  const d = new Date(year, month + delta, 1)
  return makeMonthKey(d.getFullYear(), d.getMonth())
}

/** Lista de N chaves de mes terminando em `key` (inclusive) */
export function lastMonths(key, count) {
  const out = []
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(key, -i))
  return out
}

/** Chave do mes atual */
export function currentMonthKey() {
  const d = new Date()
  return makeMonthKey(d.getFullYear(), d.getMonth())
}

/** Data de hoje no formato AAAA-MM-DD */
export function todayISO() {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/** Formata AAAA-MM-DD como DD/MM/AAAA */
export function formatDate(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = String(isoDate).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** Formata AAAA-MM-DD como "12 mar" */
/** Quantidade de dias entre hoje e uma data (positivo = futuro) */
export function daysUntil(isoDate) {
  if (!isoDate) return 0
  const target = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((target - now) / 86400000)
}

/** Ultimo dia do mes de uma chave "AAAA-MM" */
export function lastDayOfMonth(key) {
  const { year, month } = parseMonthKey(key)
  return new Date(year, month + 1, 0).getDate()
}

/** Constroi data ISO respeitando o ultimo dia do mes */
export function isoDateInMonth(monthKey, day) {
  const max = lastDayOfMonth(monthKey)
  const d = Math.min(Math.max(1, Number(day) || 1), max)
  return `${monthKey}-${String(d).padStart(2, '0')}`
}

/** Variacao percentual entre dois valores */
export function percentChange(current, previous) {
  const c = Number(current) || 0
  const p = Number(previous) || 0
  if (p === 0) return c === 0 ? 0 : null
  return ((c - p) / Math.abs(p)) * 100
}

/** Gera id unico simples */
export function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Converte string digitada em numero (aceita "1.234,56" e "1234.56") */
export function parseAmount(input) {
  if (typeof input === 'number') return input
  if (!input) return 0
  let s = String(input).trim().replace(/[R$\s]/g, '')
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Mascara monetaria para digitacao: os dois ultimos digitos sao os centavos.
 * Ex.: "123456" -> "1.234,56" e "1" -> "0,01".
 */
export function formatAmountInput(input) {
  const digits = String(input ?? '').replace(/\D/g, '')
  if (!digits) return ''

  const cents = digits.replace(/^0+(?=\d)/, '').padStart(3, '0')
  const integer = cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${integer},${cents.slice(-2)}`
}

/** Converte um valor numerico ja salvo para a mascara de digitacao. */
export function amountToInput(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return ''
  return formatAmountInput(String(Math.round(Math.abs(amount) * 100)))
}
