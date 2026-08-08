import { useCallback, useMemo } from 'react'
import { useLocalStorage } from './useLocalStorage.js'
import { DEFAULT_CATEGORIES, fallbackCategoryId, normalizeType } from '../utils/categories.js'
import { expandMonth } from '../utils/recurrence.js'
import { DEFAULT_TRANSACTION_FORM_FIELDS, normalizeTransactionFormFields } from '../utils/transactionFormFields.js'
import {
  addMonths,
  currentMonthKey,
  lastMonths,
  percentChange,
  uid,
} from '../utils/format.js'

const KEYS = {
  transactions: 'planejador:transactions',
  categories: 'planejador:categories',
  budgets: 'planejador:budgets',
  goals: 'planejador:goals',
  theme: 'planejador:theme',
  transactionFormFields: 'planejador:transaction-form-fields',
}

/** Normaliza um lancamento vindo do formulario */
function normalizeTransaction(input) {
  return {
    id: input.id || uid(),
    type: normalizeType(input.type),
    description: String(input.description || '').trim() || 'Sem descrição',
    amount: Math.abs(Number(input.amount) || 0),
    categoryId: input.categoryId || 'outros-d',
    date: String(input.date || '').slice(0, 10),
    method: input.method || 'pix',
    paid: input.paid !== false,
    recurrence: input.recurrence || 'none',
    recurrenceEnd: input.recurrenceEnd || '',
    installments: Math.max(1, Number(input.installments) || 1),
    tags: Array.isArray(input.tags)
      ? input.tags
      : String(input.tags || '')
          .split(/[,\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
    note: String(input.note || ''),
    paidOccurrences: input.paidOccurrences || {},
    createdAt: input.createdAt || new Date().toISOString(),
  }
}

export function useFinance() {
  const [transactions, setTransactions, resetTransactions] = useLocalStorage(
    KEYS.transactions,
    [],
  )
  const [categories, setCategories, resetCategories] = useLocalStorage(
    KEYS.categories,
    DEFAULT_CATEGORIES,
  )
  const [budgets, setBudgets, resetBudgets] = useLocalStorage(KEYS.budgets, {})
  const [goals, setGoals, resetGoals] = useLocalStorage(KEYS.goals, [])
  const [theme, setTheme] = useLocalStorage(KEYS.theme, 'light')
  const [transactionFormFields, setStoredTransactionFormFields] = useLocalStorage(KEYS.transactionFormFields, DEFAULT_TRANSACTION_FORM_FIELDS)
  const setTransactionFormFields = useCallback(
    (fields) => setStoredTransactionFormFields(normalizeTransactionFormFields(fields)),
    [setStoredTransactionFormFields],
  )

  // ---------- Lancamentos ----------

  const addTransaction = useCallback(
    (input) => {
      const tx = normalizeTransaction(input)
      setTransactions((prev) => [tx, ...prev])
      return tx
    },
    [setTransactions],
  )

  const updateTransaction = useCallback(
    (id, input) => {
      const rootId = String(id).split('#')[0]
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === rootId ? normalizeTransaction({ ...t, ...input, id: rootId }) : t,
        ),
      )
    },
    [setTransactions],
  )

  const deleteTransaction = useCallback(
    (id) => {
      const rootId = String(id).split('#')[0]
      setTransactions((prev) => prev.filter((t) => t.id !== rootId))
    },
    [setTransactions],
  )

  const duplicateTransaction = useCallback(
    (occurrence) => {
      const copy = normalizeTransaction({
        ...occurrence,
        id: uid(),
        description: `${occurrence.description} (cópia)`,
        recurrence: 'none',
        installments: 1,
        paidOccurrences: {},
        createdAt: new Date().toISOString(),
      })
      setTransactions((prev) => [copy, ...prev])
    },
    [setTransactions],
  )

  /** Alterna pago/pendente respeitando ocorrencias de recorrencia */
  const togglePaid = useCallback(
    (occurrence) => {
      const rootId = occurrence.sourceId || String(occurrence.id).split('#')[0]
      const index = occurrence.occurrenceIndex || 0
      setTransactions((prev) =>
        prev.map((t) => {
          if (t.id !== rootId) return t
          if (index === 0) return { ...t, paid: !(t.paid !== false) }
          const map = { ...(t.paidOccurrences || {}) }
          if (map[index]) delete map[index]
          else map[index] = true
          return { ...t, paidOccurrences: map }
        }),
      )
    },
    [setTransactions],
  )

  // ---------- Categorias ----------

  const addCategory = useCallback(
    (cat) => {
      const id =
        cat.id ||
        `${String(cat.name || 'cat')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 5)}`
      setCategories((prev) => [
        ...prev,
        {
          id,
          name: String(cat.name || 'Nova categoria').trim(),
          type: normalizeType(cat.type),
          color: cat.color || '#6366f1',
          icon: cat.icon || '📁',
          targetPercentage: Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0)),
          custom: true,
        },
      ])
    },
    [setCategories],
  )

  const updateCategory = useCallback(
    (id, patch) => {
      setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    },
    [setCategories],
  )

  const deleteCategory = useCallback(
    (id) => {
      setCategories((prev) => prev.filter((c) => c.id !== id))
      setBudgets((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      // lancamentos orfaos vao para "Outros" do tipo correspondente
      // (reinvestido cai em Outros de despesa)
      setTransactions((prev) =>
        prev.map((t) =>
          t.categoryId === id
            ? { ...t, categoryId: fallbackCategoryId(t.type) }
            : t,
        ),
      )
    },
    [setCategories, setBudgets, setTransactions],
  )

  // ---------- Orcamento ----------

  const setBudget = useCallback(
    (categoryId, limit) => {
      setBudgets((prev) => {
        const next = { ...prev }
        const n = Number(limit) || 0
        if (n <= 0) delete next[categoryId]
        else next[categoryId] = n
        return next
      })
    },
    [setBudgets],
  )

  // ---------- Metas ----------

  const addGoal = useCallback(
    (goal) => {
      setGoals((prev) => [
        ...prev,
        {
          id: uid(),
          name: String(goal.name || 'Nova meta').trim(),
          target: Math.abs(Number(goal.target) || 0),
          current: Math.abs(Number(goal.current) || 0),
          deadline: goal.deadline || '',
          icon: goal.icon || '🎯',
          color: goal.color || '#6366f1',
        },
      ])
    },
    [setGoals],
  )

  const updateGoal = useCallback(
    (id, patch) => {
      setGoals((prev) =>
        prev.map((g) =>
          g.id === id
            ? {
                ...g,
                ...patch,
                target: patch.target !== undefined ? Math.abs(Number(patch.target) || 0) : g.target,
                current:
                  patch.current !== undefined ? Math.abs(Number(patch.current) || 0) : g.current,
              }
            : g,
        ),
      )
    },
    [setGoals],
  )

  const deleteGoal = useCallback(
    (id) => setGoals((prev) => prev.filter((g) => g.id !== id)),
    [setGoals],
  )

  // ---------- Dados / backup ----------

  const exportData = useCallback(
    () => ({ transactions, categories, budgets, goals }),
    [transactions, categories, budgets, goals],
  )

  const importData = useCallback(
    (data) => {
      if (Array.isArray(data.transactions)) {
        setTransactions(data.transactions.map(normalizeTransaction))
      }
      if (Array.isArray(data.categories) && data.categories.length) {
        setCategories(data.categories)
      }
      if (data.budgets && typeof data.budgets === 'object') setBudgets(data.budgets)
      if (Array.isArray(data.goals)) setGoals(data.goals)
    },
    [setTransactions, setCategories, setBudgets, setGoals],
  )

  const clearAll = useCallback(() => {
    resetTransactions()
    resetCategories()
    resetBudgets()
    resetGoals()
  }, [resetTransactions, resetCategories, resetBudgets, resetGoals])

  return {
    // estado
    transactions,
    categories,
    budgets,
    goals,
    theme,
    transactionFormFields: normalizeTransactionFormFields(transactionFormFields),
    // acoes
    addTransaction,
    updateTransaction,
    deleteTransaction,
    duplicateTransaction,
    togglePaid,
    addCategory,
    updateCategory,
    deleteCategory,
    setBudget,
    addGoal,
    updateGoal,
    deleteGoal,
    setTheme,
    setTransactionFormFields,
    exportData,
    importData,
    clearAll,
  }
}

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
      // Saida de liquidez, mas patrimonio (nao e consumo)
      reinvested += amount
      if (!t.paid) pendingExpense += amount
    } else {
      expense += amount
      if (!t.paid) pendingExpense += amount
    }
  }

  // Saldo do mes desconta consumo E reinvestimento da liquidez disponivel
  const balance = income - expense - reinvested
  // REQ 3: taxa de poupanca = quanto da receita virou patrimonio reinvestido
  const savingsRate = income > 0 ? (reinvested / income) * 100 : 0
  // Patrimonio formado no mes (base para o card acumulado)
  const patrimony = reinvested

  return {
    income,
    expense,
    reinvested,
    balance,
    savingsRate,
    patrimony,
    pendingExpense,
    pendingIncome,
  }
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

    const history = lastMonths(key, monthsBack).map((k) => {
      const s = summarize(expandMonth(transactions, k))
      return { key: k, ...s }
    })

    let cumulative = 0
    let cumulativePatrimony = 0
    const trend = history.map((h) => {
      cumulative += h.balance
      cumulativePatrimony += h.patrimony || 0
      return { ...h, cumulative, cumulativePatrimony }
    })

    // Patrimonio acumulado ate o mes selecionado (inclusive)
    const accumulatedPatrimony =
      trend.find((h) => h.key === key)?.cumulativePatrimony ?? current.patrimony

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
      accumulatedPatrimony,
      history,
      trend,
    }
  }, [transactions, monthKey, monthsBack])
}
