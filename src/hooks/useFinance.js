import { useMemo } from 'react'
import { expandMonth } from '../utils/recurrence.js'
import { addMonths, currentMonthKey, lastMonths, monthKeyFromDate, percentChange } from '../utils/format.js'

/** Resumo de uma lista de ocorrencias */
export function summarize(occurrences) {
  let income = 0
  let expense = 0
  let reinvested = 0
  let pendingExpense = 0
  let pendingIncome = 0

  for (const t of occurrences) {
    const amount = Number(t.amount) || 0
    if (t.type === 'income') {
      income += amount
      if (!t.paid) pendingIncome += amount
    } else if (t.type === 'reinvested') {
      reinvested += amount
      if (!t.paid) pendingExpense += amount
    } else {
      expense += amount
      if (!t.paid) pendingExpense += amount
    }
  }

  const balance = income - expense - reinvested
  const savingsRate = income > 0 ? (reinvested / income) * 100 : 0
  const patrimony = reinvested

  return { income, expense, reinvested, balance, savingsRate, patrimony, pendingExpense, pendingIncome }
}

/** Totais por categoria (apenas despesas por padrao) */
export function totalsByCategory(occurrences, type = 'expense') {
  const map = {}
  for (const t of occurrences) {
    if (t.type !== type) continue
    map[t.categoryId] = (map[t.categoryId] || 0) + (Number(t.amount) || 0)
  }
  return map
}

/** Hook derivado: tudo que a interface precisa para o mes selecionado */
export function useMonthlyData(transactions, monthKey, monthsBack = 12) {
  return useMemo(() => {
    const key = monthKey || currentMonthKey()
    const occurrences = expandMonth(transactions, key)
    const previous = expandMonth(transactions, addMonths(key, -1))
    const current = summarize(occurrences)
    const prev = summarize(previous)
    const firstDataMonth = transactions
      .map((transaction) => monthKeyFromDate(transaction.date))
      .filter(Boolean)
      .sort()[0]
    const historyKeys = lastMonths(key, Math.min(Number(monthsBack) || 12, 12))
      .filter((month) => firstDataMonth && month >= firstDataMonth)
    const history = historyKeys.map((k) => ({ key: k, ...summarize(expandMonth(transactions, k)) }))

    let cumulative = 0
    let cumulativePatrimony = 0
    const trend = history.map((h) => {
      cumulative += h.balance
      cumulativePatrimony += h.patrimony || 0
      return { ...h, cumulative, cumulativePatrimony }
    })

    return {
      monthKey: key,
      occurrences,
      summary: current,
      previousSummary: prev,
      change: {
        income: percentChange(current.income, prev.income),
        expense: percentChange(current.expense, prev.expense),
        balance: percentChange(current.balance, prev.balance),
        savingsRate: percentChange(current.savingsRate, prev.savingsRate),
      },
      byCategory: totalsByCategory(occurrences, 'expense'),
      byCategoryIncome: totalsByCategory(occurrences, 'income'),
      byCategoryReinvested: totalsByCategory(occurrences, 'reinvested'),
      previousByCategory: totalsByCategory(previous, 'expense'),
      accumulatedPatrimony: trend.find((h) => h.key === key)?.cumulativePatrimony ?? current.patrimony,
      history,
      trend,
    }
  }, [transactions, monthKey, monthsBack])
}
