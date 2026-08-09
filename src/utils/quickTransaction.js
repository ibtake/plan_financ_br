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
  const normalizedDescription = normalize(description)
  const words = new Set(tokens(description))
  const options = categories.filter((category) => category.type === type)
  const historicalMatch = transactions.find((transaction) => (
    transaction.type === type
    && normalize(transaction.description) === normalizedDescription
    && options.some((category) => category.id === transaction.categoryId)
  ))
  if (historicalMatch) return historicalMatch.categoryId

  let best = null
  let bestScore = 0

  for (const category of options) {
    let score = tokens(category.name).reduce((sum, word) => sum + (words.has(word) ? 5 : 0), 0)
    for (const transaction of transactions) {
      if (transaction.type !== type || transaction.categoryId !== category.id) continue
      const historicalDescription = normalize(transaction.description)
      const match = tokens(transaction.description).filter((word) => words.has(word)).length
      if (normalizedDescription && (historicalDescription.includes(normalizedDescription) || normalizedDescription.includes(historicalDescription))) {
        score = Math.max(score, 20)
      } else {
        score = Math.max(score, match * 4)
      }
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
  const dateMatch = text.match(/\bdia\s*(\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/i)
  const amountIsDate = amountMatch && dateMatch
    && amountMatch.index >= dateMatch.index
    && amountMatch.index < dateMatch.index + dateMatch[0].length
  const amountText = amountMatch && !amountIsDate
    ? `${amountMatch[1]}${amountMatch[2] || amountMatch[3] ? `,${amountMatch[2] || amountMatch[3]}` : ''}`
    : ''
  const amount = amountText ? parseAmount(amountText) : 0
  const relativeDay = dateMatch?.[1] ? Number(dateMatch[1]) : null
  const absoluteDay = dateMatch?.[2] ? Number(dateMatch[2]) : null
  const absoluteMonth = dateMatch?.[3] ? Number(dateMatch[3]) : null
  const absoluteYear = dateMatch?.[4]
    ? Number(String(dateMatch[4]).length === 2 ? `20${dateMatch[4]}` : dateMatch[4])
    : null
  let date = defaultDate
  if (absoluteDay && absoluteMonth) {
    const base = new Date(`${defaultDate}T12:00:00`)
    const baseYear = base.getFullYear()
    const year = absoluteYear || baseYear
    const candidate = new Date(year, absoluteMonth - 1, absoluteDay, 12)
    if (
      Number.isFinite(candidate.getTime())
      && candidate.getFullYear() === year
      && candidate.getMonth() === absoluteMonth - 1
      && candidate.getDate() === absoluteDay
    ) {
      date = `${year}-${String(absoluteMonth).padStart(2, '0')}-${String(absoluteDay).padStart(2, '0')}`
    }
  } else if (relativeDay) {
    date = dateForDay(relativeDay, defaultDate)
  }
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
