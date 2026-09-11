// Deteccao de lancamento potencialmente duplicado no mes (IMPR-012/DIN-64).
//
// Puro e somente-leitura: expande o mes da DATA DIGITADA e procura uma
// ocorrencia com mesma descricao normalizada e mesmo valor. Nao muta as
// ocorrencias (invariante do cache de recurrence.js).

import { monthKeyFromDate } from './format.js'
import { expandMonth } from './recurrence.js'
import { normalize } from './quickTransaction.js'

// A copia de um lancamento ganha " (copia)" no fim (useFinanceOperations.js:68);
// sem tirar o sufixo, o original nunca casaria com a copia recem-criada.
const stripCopySuffix = (description) => normalize(description).replace(/\s*copia\s*$/, '').trim()

/**
 * Retorna a ocorrencia candidata a duplicata de `form` no mes da sua data, ou
 * null. Mesma descricao normalizada + mesmo valor bastam; o proprio item
 * (mesma origem) e ignorado, senao todo save de edicao se autodenunciaria.
 */
export function findDuplicateInMonth(form, transactions) {
  const monthKey = monthKeyFromDate(form?.date)
  if (!monthKey || !Array.isArray(transactions) || !transactions.length) return null

  const amount = Number(form.amount) || 0
  if (amount <= 0) return null
  const description = stripCopySuffix(form.description)
  if (!description) return null

  const ownSource = form.sourceId || form.id || null

  return expandMonth(transactions, monthKey).find((occurrence) => (
    occurrence.sourceId !== ownSource
    && (Number(occurrence.amount) || 0) === amount
    && stripCopySuffix(occurrence.description) === description
  )) || null
}
