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
export function useMonthlyData(transactions, monthKey) {
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
    // Este bloco - historyKeys, history e trend - existe SO para o grafico, que e
    // a SEGUNDA instancia deste hook: App.jsx chama useMonthlyData duas vezes
    // (`:143` monthly, `:147` chartMonthly) e as leituras nao se cruzam - monthly
    // le os outros nove campos e nunca `trend`, chartMonthly le `trend` e nada
    // mais (`:254`, `:255`). Cada instancia calcula dez campos e usa um lote.
    //
    // Medido no B79 e deixado assim de proposito. Separar em dois hooks levaria as
    // 44 chamadas de expandMonth e de summarize por render para 22, e as 6 de
    // totalsByCategory para 3 - as mesmas 44 que a instrumentacao do B22 contou -,
    // mas o memo de recurrence.js:135 ja tinha comido o caro. Em base de peso
    // equivalente a daquela medicao (256 ocorrencias no mes) o ganho na navegacao
    // de mes fica entre -0,004 e +0,041 ms: troca de sinal entre execucoes, ou
    // seja, ruido. Com base 7x mais pesada (1 079 ocorrencias) sao 0,09-0,13 ms. E
    // navegar entre meses passados nem recalcula chartMonthly - chartMonthKey fica
    // preso em currentMonthKey() (App.jsx:146). Reabrir se o delta passar de um
    // frame, ou se aparecer consumidor que queira `trend` sem os outros nove.
    //
    // 12 fixo: era o parametro `monthsBack`, que nenhuma chamada passava - as
    // duas de App.jsx (`:143`, `:147`) e as cinco de test/useFinance.test.js - e
    // que o Math.min(..., 12) so deixava encurtar a janela, nunca esticar: API
    // prometendo alcance que nao entregava (B59).
    const historyKeys = lastMonths(key, 12)
      .filter((month) => firstDataMonth && month >= firstDataMonth)
    // Local, nao devolvido: `trend` mapeia sobre ele logo abaixo, entao o
    // calculo continua obrigatorio - o que saiu do retorno foi so a chave.
    const history = historyKeys.map((k) => ({ key: k, ...summarize(expandMonth(transactions, k)) }))

    let cumulative = 0
    const trend = history.map((h) => {
      cumulative += h.balance
      return { ...h, cumulative }
    })

    // Patrimonio do ano do mes selecionado, de janeiro ate ele. Nao reaproveita
    // historyKeys de proposito: aquela janela e rolante de 12 meses e alimenta o
    // grafico. O card somava dentro dela, entao cada mes novo empurrava o mais
    // antigo para fora e o total encolhia sozinho (achado 1.15). key.slice(0,4)
    // faz o card acompanhar o seletor: trocar de ano traz o total daquele ano,
    // sem ficar preso no anterior. O corte em `key` exclui os meses futuros do
    // ano - patrimonio e estoque, nao projecao.
    const yearPatrimony = lastMonths(`${key.slice(0, 4)}-12`, 12)
      .filter((month) => firstDataMonth && month >= firstDataMonth && month <= key)
      .reduce((sum, k) => sum + summarize(expandMonth(transactions, k)).patrimony, 0)

    return {
      monthKey: key,
      occurrences,
      summary: current,
      previousSummary: prev,
      change: {
        income: percentChange(current.income, prev.income),
        expense: percentChange(current.expense, prev.expense),
      },
      byCategory: totalsByCategory(occurrences, 'expense'),
      byCategoryReinvested: totalsByCategory(occurrences, 'reinvested'),
      previousByCategory: totalsByCategory(previous, 'expense'),
      accumulatedPatrimony: yearPatrimony,
      trend,
    }
  }, [transactions, monthKey])
}
