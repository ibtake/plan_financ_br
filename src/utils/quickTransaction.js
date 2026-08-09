import { parseAmount } from './format.js'

const WORDS = /\b(?:paguei|pagar|recebi|receber|gastei|conta|despesa|receita|dia|em|no|na)\b/gi

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value) {
  return normalize(value).split(/\s+/).filter((token) => token.length > 2)
}

function dateForDay(day, baseDate) {
  const base = new Date(`${baseDate}T12:00:00`)
  if (!Number.isFinite(base.getTime()) || day < 1 || day > 31) return baseDate
  const year = base.getFullYear()
  const month = base.getMonth()
  const candidate = new Date(year, month, day, 12)
  return candidate.getMonth() === month
    ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : baseDate
}

function inferCategory(description, type, categories, transactions) {
  const words = new Set(tokens(description))
  const options = categories.filter((category) => category.type === type)
  let best = null
  let bestScore = 0

  for (const category of options) {
    let score = tokens(category.name).reduce((sum, word) => sum + (words.has(word) ? 5 : 0), 0)
    for (const transaction of transactions) {
      if (transaction.type !== type || transaction.categoryId !== category.id) continue
      const match = tokens(transaction.description).filter((word) => words.has(word)).length
      score = Math.max(score, match * 4)
    }
    if (score > bestScore) {
      best = category
      bestScore = score
    }
  }
  return best?.id || options[0]?.id || ''
}

export function parseQuickTransaction(input, { defaultDate, categories, transactions }) {
  const text = String(input || '').trim()
  if (!text) return null

  const amountMatch = text.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:[,.]\s*(\d{1,2})|\s+e\s+(\d{1,2}))?(?:\s*reais?)?/i)
  const dateMatch = text.match(/\bdia\s*(\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b/i)
  const amountIsDate = amountMatch && dateMatch
    && amountMatch.index >= dateMatch.index
    && amountMatch.index < dateMatch.index + dateMatch[0].length
  const amountText = amountMatch && !amountIsDate
    ? `${amountMatch[1]}${amountMatch[2] || amountMatch[3] ? `,${amountMatch[2] || amountMatch[3]}` : ''}`
    : ''
  const amount = amountText ? parseAmount(amountText) : 0
  const day = dateMatch ? Number(dateMatch[1] || dateMatch[2]) : null
  const date = day ? dateForDay(day, defaultDate) : defaultDate
  const type = /\b(recebi|receita|salario|renda|entrada|vendi)\b/i.test(text)
    ? 'income'
    : /\b(aporte|investi|investimento|reinvesti)\b/i.test(text)
      ? 'reinvested'
      : 'expense'
  const description = text
    .replace(amountIsDate ? '' : amountMatch?.[0] || '', ' ')
    .replace(dateMatch?.[0] || '', ' ')
    .replace(WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    description,
    amount,
    date,
    type,
    categoryId: inferCategory(description, type, categories, transactions),
  }
}
