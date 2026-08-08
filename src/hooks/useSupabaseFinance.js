import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase, translateAuthError } from '../lib/supabase.js'
import { EVENTS, guarded, logEvent } from '../lib/audit.js'
import { DEFAULT_CATEGORIES, fallbackCategoryId, normalizeType } from '../utils/categories.js'
import { uid } from '../utils/format.js'
import { DEFAULT_TRANSACTION_FORM_FIELDS, normalizeTransactionFormFields } from '../utils/transactionFormFields.js'
import { useLocalStorage } from './useLocalStorage.js'

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
      : String(input.tags || '').split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean),
    note: String(input.note || ''),
    paidOccurrences: input.paidOccurrences || {},
    createdAt: input.createdAt || new Date().toISOString(),
  }
}

const toTxRow = (tx, userId) => ({
  id: tx.id,
  user_id: userId,
  type: tx.type,
  description: tx.description,
  amount: tx.amount,
  category_id: tx.categoryId,
  date: tx.date,
  method: tx.method,
  paid: tx.paid,
  recurrence: tx.recurrence,
  recurrence_end: tx.recurrenceEnd || null,
  installments: tx.installments,
  tags: tx.tags,
  note: tx.note || null,
  paid_occurrences: tx.paidOccurrences,
  created_at: tx.createdAt,
})

const fromTxRow = (row) => normalizeTransaction({
  id: row.id,
  type: row.type,
  description: row.description,
  amount: Number(row.amount),
  categoryId: row.category_id,
  date: row.date,
  method: row.method,
  paid: row.paid,
  recurrence: row.recurrence,
  recurrenceEnd: row.recurrence_end || '',
  installments: row.installments,
  tags: row.tags || [],
  note: row.note || '',
  paidOccurrences: row.paid_occurrences || {},
  createdAt: row.created_at,
})

const fromCategory = (row) => ({
  id: row.id, name: row.name, type: row.type, color: row.color, icon: row.icon,
  targetPercentage: Number(row.target_percentage) || 0, custom: row.custom,
})
const toCategory = (cat, userId) => ({
  id: cat.id, user_id: userId, name: cat.name, type: cat.type,
  color: cat.color, icon: cat.icon,
  target_percentage: Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0)),
  custom: cat.custom !== false,
})
const fromGoal = (row) => ({
  id: row.id, name: row.name, target: Number(row.target), current: Number(row.current),
  deadline: row.deadline || '', icon: row.icon, color: row.color,
  goalType: row.goal_type || 'standard',
  reverseOriginalAmount: Number(row.reverse_original_amount) || 0,
  reverseRemainingAmount: Number(row.reverse_remaining_amount) || 0,
  reverseCorrectedAmount: Number(row.reverse_corrected_amount) || 0,
  reverseTotalContributed: Number(row.reverse_total_contributed) || 0,
  reverseCorrectionAmount: Number(row.reverse_correction_amount) || 0,
  reverseProgressPercent: Number(row.reverse_progress_percent) || 0,
  reverseForecastCompletionDate: row.reverse_forecast_completion_date || null,
  reverseMonthlyContributionAverage: Number(row.reverse_monthly_contribution_average || 0),
  reverseStartDate: row.reverse_start_date || '',
  reverseSelicFactor: Number(row.reverse_selic_factor) || 1,
  reverseCompletedAt: row.reverse_completed_at || null,
})
const toGoal = (goal, userId) => ({
  id: goal.id, user_id: userId, name: goal.name, target: goal.target,
  current: goal.current, deadline: goal.deadline || null, icon: goal.icon, color: goal.color,
})

export function useSupabaseFinance() {
  const { user, signOut } = useAuth()
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [budgets, setBudgets] = useState({})
  const [goals, setGoals] = useState([])
  const [reverseGoalHistory, setReverseGoalHistory] = useState([])
  const [reverseGoalContributions, setReverseGoalContributions] = useState([])
  const [standardGoalContributions, setStandardGoalContributions] = useState([])
  const [reverseGoalEvents, setReverseGoalEvents] = useState([])
  const [reverseGoalRetentionMonths, setReverseGoalRetentionMonths] = useState(null)
  const [theme, setTheme] = useLocalStorage('planejador:theme', 'auto')
  const [transactionFormFields, setTransactionFormFieldsState] = useState(DEFAULT_TRANSACTION_FORM_FIELDS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isDeletingGoal, setIsDeletingGoal] = useState(false)
  const [goalDeletionPhase, setGoalDeletionPhase] = useState('')
  const latestLoadRequest = useRef(0)
  const deleteGoalInFlight = useRef(false)
  const transactionFormFieldsQueue = useRef(Promise.resolve())
  const confirmedTransactionFormFields = useRef(DEFAULT_TRANSACTION_FORM_FIELDS)
  const transactionFormFieldsVersion = useRef(0)

  const reportError = useCallback((dbError) => {
    setError(translateAuthError(dbError))
    window.setTimeout(() => setError(''), 6000)
  }, [])

  const load = useCallback(async ({ preserveError = false } = {}) => {
    const requestId = ++latestLoadRequest.current
    if (!user || !supabase) {
      if (requestId === latestLoadRequest.current) setLoading(false)
      return false
    }
    setLoading(true)
    if (!preserveError) setError('')
    // Preferencias de interface nao podem impedir o acesso aos dados financeiros.
    // A leitura permanece paralela, mas e tratada separadamente para manter a
    // compatibilidade caso o frontend seja publicado antes da migracao.
    const profileRequest = guarded(
      () => supabase.from('profiles').select('transaction_form_fields').maybeSingle(),
      { table: 'profiles', action: 'select_transaction_form_fields' },
    )
    // O resumo principal nao depende dos historicos de metas. Eles continuam
    // sendo buscados em paralelo, mas nao devem segurar a primeira tela apos
    // login, especialmente em redes moveis.
    const supportingDataRequest = Promise.all([
      guarded(() => supabase.from('reverse_goal_history').select('*').order('reference_month', { ascending: false }), { table: 'reverse_goal_history', action: 'select' }),
      guarded(() => supabase.from('reverse_goal_contributions').select('*').order('occurred_on', { ascending: false }), { table: 'reverse_goal_contributions', action: 'select' }),
      guarded(() => supabase.from('standard_goal_contributions').select('*').order('occurred_on', { ascending: false }), { table: 'standard_goal_contributions', action: 'select' }),
      guarded(() => supabase.from('reverse_goal_events').select('*').order('occurred_on', { ascending: false }), { table: 'reverse_goal_events', action: 'select' }),
      guarded(() => supabase.from('reverse_goal_retention_settings').select('completed_goal_retention_months').maybeSingle(), { table: 'reverse_goal_retention_settings', action: 'select' }),
    ])
    const [txResult, catResult, budgetResult, goalResult] = await Promise.all([
      guarded(() => supabase.from('transactions').select('*').order('created_at', { ascending: false }), { table: 'transactions', action: 'select' }),
      guarded(() => supabase.from('categories').select('*').order('created_at'), { table: 'categories', action: 'select' }),
      guarded(() => supabase.from('budgets').select('*'), { table: 'budgets', action: 'select' }),
      guarded(() => supabase.from('goals').select('*').order('created_at'), { table: 'goals', action: 'select' }),
    ])
    // Uma carga iniciada antes de uma mutacao nao pode restaurar um snapshot
    // antigo sobre os dados que acabaram de ser confirmados pelo servidor.
    if (requestId !== latestLoadRequest.current) return false
    const firstError = [txResult, catResult, budgetResult, goalResult].find((r) => r.error)?.error
    if (firstError) {
      const code = String(firstError.code || '')
      const message = String(firstError.message || '').toLowerCase()
      if (code === 'PGRST301' || message.includes('jwt expired') || message.includes('token is expired')) {
        await signOut('session_expired')
        return false
      }
      reportError(firstError)
      // Uma falha de leitura não pode transformar a interface em uma
      // Dashboard aparentemente válida, mas zerada. Os últimos dados são
      // preservados até uma carga posterior bem-sucedida.
      setLoading(false)
      return false
    }
    setTransactions((txResult.data || []).map(fromTxRow))
    setCategories((catResult.data || []).map(fromCategory))
    setBudgets(Object.fromEntries((budgetResult.data || []).map((row) => [row.category_id, Number(row.limit_amount)])))
    setGoals((goalResult.data || []).map(fromGoal))
    setLoading(false)

    void supportingDataRequest.then(async ([reverseHistoryResult, reverseContributionsResult, standardContributionsResult, reverseEventsResult, retentionResult]) => {
      if (requestId !== latestLoadRequest.current) return
      const supportingError = [reverseHistoryResult, reverseContributionsResult, standardContributionsResult, reverseEventsResult, retentionResult].find((result) => result.error)?.error
      if (supportingError) {
        const code = String(supportingError.code || '')
        const message = String(supportingError.message || '').toLowerCase()
        if (code === 'PGRST301' || message.includes('jwt expired') || message.includes('token is expired')) {
          await signOut('session_expired')
          return
        }
        reportError(supportingError)
        return
      }
      setReverseGoalHistory(reverseHistoryResult.data || [])
      setReverseGoalContributions(reverseContributionsResult.data || [])
      setStandardGoalContributions(standardContributionsResult.data || [])
      setReverseGoalEvents(reverseEventsResult.data || [])
      setReverseGoalRetentionMonths(retentionResult.data?.completed_goal_retention_months ?? null)
    })

    void profileRequest.then((profileResult) => {
      if (requestId !== latestLoadRequest.current) return
      if (profileResult.error) {
        setTransactionFormFieldsState(DEFAULT_TRANSACTION_FORM_FIELDS)
        return
      }
      const confirmedFields = normalizeTransactionFormFields(profileResult.data?.transaction_form_fields)
      confirmedTransactionFormFields.current = confirmedFields
      setTransactionFormFieldsState(confirmedFields)
    })
    return true
  // A troca do access token nao muda o usuario nem os dados. Deixar a sessao
  // fora das dependencias evita uma nova carga completa a cada TOKEN_REFRESHED.
  }, [reportError, signOut, user])

  useEffect(() => { load() }, [load])

  const persist = useCallback(async (operation, context) => {
    const result = await guarded(operation, context)
    if (result.error) {
      reportError(result.error)
      await load({ preserveError: true })
      return false
    }
    return true
  }, [load, reportError])

  const addTransaction = useCallback((input) => {
    const tx = normalizeTransaction(input)
    setTransactions((prev) => [tx, ...prev])
    void persist(() => supabase.from('transactions').insert(toTxRow(tx, user.id)), { table: 'transactions', action: 'insert' })
    return tx
  }, [persist, user])

  const updateTransaction = useCallback((id, input) => {
    const rootId = String(id).split('#')[0]
    let updated
    setTransactions((prev) => prev.map((tx) => {
      if (tx.id !== rootId) return tx
      updated = normalizeTransaction({ ...tx, ...input, id: rootId })
      return updated
    }))
    if (updated) void persist(
      () => supabase.from('transactions').update(toTxRow(updated, user.id)).eq('id', rootId).eq('user_id', user.id),
      { table: 'transactions', action: 'update' },
    )
  }, [persist, user])

  const deleteTransaction = useCallback((id) => {
    const rootId = String(id).split('#')[0]
    setTransactions((prev) => prev.filter((tx) => tx.id !== rootId))
    void persist(() => supabase.from('transactions').delete().eq('id', rootId).eq('user_id', user.id), { table: 'transactions', action: 'delete' })
  }, [persist, user])

  const duplicateTransaction = useCallback((occurrence) => addTransaction({
    ...occurrence, id: uid(), description: `${occurrence.description} (cópia)`, recurrence: 'none',
    installments: 1, paidOccurrences: {}, createdAt: new Date().toISOString(),
  }), [addTransaction])

  const togglePaid = useCallback((occurrence) => {
    const rootId = occurrence.sourceId || String(occurrence.id).split('#')[0]
    const index = occurrence.occurrenceIndex || 0
    const root = transactions.find((tx) => tx.id === rootId)
    if (!root) return
    const updated = { ...root }
    if (index === 0) updated.paid = !updated.paid
    else {
      updated.paidOccurrences = { ...(root.paidOccurrences || {}) }
      if (updated.paidOccurrences[index]) delete updated.paidOccurrences[index]
      else updated.paidOccurrences[index] = true
    }
    updateTransaction(rootId, updated)
  }, [transactions, updateTransaction])

  const addCategory = useCallback((input) => {
    const base = String(input.name || 'cat').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const cat = { id: input.id || `${base}-${Math.random().toString(36).slice(2, 5)}`, name: String(input.name || 'Nova categoria').trim(), type: normalizeType(input.type), color: input.color || '#6366f1', icon: input.icon || '📁', targetPercentage: Math.max(0, Math.min(100, Number(input.targetPercentage) || 0)), custom: true }
    setCategories((prev) => [...prev, cat])
    void persist(() => supabase.from('categories').insert(toCategory(cat, user.id)), { table: 'categories', action: 'insert' })
  }, [persist, user])

  const updateCategory = useCallback((id, patch) => {
    setCategories((prev) => prev.map((cat) => cat.id === id ? { ...cat, ...patch } : cat))
    // Traduz o estado (camelCase) para as colunas do banco (snake_case)
    const allowed = {}
    if (patch.name !== undefined) allowed.name = patch.name
    if (patch.type !== undefined) allowed.type = normalizeType(patch.type)
    if (patch.color !== undefined) allowed.color = patch.color
    if (patch.icon !== undefined) allowed.icon = patch.icon
    if (patch.targetPercentage !== undefined) {
      allowed.target_percentage = Math.max(0, Math.min(100, Number(patch.targetPercentage) || 0))
    }
    void persist(() => supabase.from('categories').update(allowed).eq('id', id).eq('user_id', user.id), { table: 'categories', action: 'update' })
  }, [persist, user])

  const deleteCategory = useCallback((id) => {
    const category = categories.find((cat) => cat.id === id)
    if (!category?.custom) return
    // Reatribui os lancamentos ligados a uma categoria "Outros" do mesmo grupo
    // ANTES de excluir. Isso evita erro de chave estrangeira e lancamentos orfaos.
    const fallback = fallbackCategoryId(category.type)
    setCategories((prev) => prev.filter((cat) => cat.id !== id))
    setBudgets((prev) => { const next = { ...prev }; delete next[id]; return next })
    setTransactions((prev) => prev.map((tx) => tx.categoryId === id ? { ...tx, categoryId: fallback } : tx))
    void (async () => {
      // Ordem importa: primeiro solta as referencias, depois remove a categoria.
      // persist() recarrega do servidor em caso de erro, mantendo a UI coerente.
      const okTx = await persist(() => supabase.from('transactions').update({ category_id: fallback }).eq('category_id', id).eq('user_id', user.id), { table: 'transactions', action: 'update_category' })
      const okBudget = await persist(() => supabase.from('budgets').delete().eq('category_id', id).eq('user_id', user.id), { table: 'budgets', action: 'delete' })
      // So exclui a categoria depois que as dependencias sairam com sucesso.
      if (okTx && okBudget) {
        await persist(() => supabase.from('categories').delete().eq('id', id).eq('user_id', user.id), { table: 'categories', action: 'delete' })
      }
    })()
  }, [categories, persist, user])

  const setBudget = useCallback((categoryId, limit) => {
    const amount = Number(limit) || 0
    setBudgets((prev) => { const next = { ...prev }; if (amount <= 0) delete next[categoryId]; else next[categoryId] = amount; return next })
    if (amount <= 0) void persist(() => supabase.from('budgets').delete().eq('category_id', categoryId).eq('user_id', user.id), { table: 'budgets', action: 'delete' })
    else void persist(() => supabase.from('budgets').upsert({ user_id: user.id, category_id: categoryId, limit_amount: amount }), { table: 'budgets', action: 'upsert' })
  }, [persist, user])

  const addGoal = useCallback(async (input) => {
    const { error: rpcError } = await supabase.rpc('create_standard_goal', {
      p_name: String(input.name || '').trim(),
      p_target: Math.abs(Number(input.target) || 0),
      p_initial_contribution: Math.abs(Number(input.current) || 0),
      p_deadline: input.deadline || null,
      p_icon: input.icon || '🎯',
      p_color: input.color || '#6366f1',
    })
    if (rpcError) { reportError(rpcError); return false }
    await load()
    return true
  }, [load, reportError])

  const addStandardGoalContribution = useCallback(async (goalId, input) => {
    const { error: rpcError } = await supabase.rpc('add_standard_goal_contribution', {
      p_goal_id: goalId,
      p_amount: Math.abs(Number(input.amount) || 0),
      p_occurred_on: input.occurredOn,
    })
    if (rpcError) { reportError(rpcError); return false }
    await load()
    return true
  }, [load, reportError])

  const updateStandardGoalContribution = useCallback(async (contributionId, input) => {
    const { error: rpcError } = await supabase.rpc('update_standard_goal_contribution', {
      p_contribution_id: contributionId,
      p_amount: Math.abs(Number(input.amount) || 0),
      p_occurred_on: input.occurredOn,
    })
    if (rpcError) { reportError(rpcError); return false }
    await load()
    return true
  }, [load, reportError])

  const addReverseGoal = useCallback(async (input) => {
    const { error: rpcError } = await supabase.rpc('create_reverse_goal', {
      p_name: String(input.name || '').trim(),
      p_original_amount: Math.abs(Number(input.originalAmount) || 0),
      p_initial_contribution: Math.abs(Number(input.initialContribution) || 0),
      p_start_date: input.startDate,
      p_selic_factor: Number(input.selicFactor) || 1,
      p_icon: input.icon || '🎯',
      p_color: input.color || '#6366f1',
    })
    if (rpcError) {
      reportError(rpcError)
      return false
    }
    await load()
    return true
  }, [load, reportError])

  const addReverseGoalContribution = useCallback(async (goalId, input) => {
    const { error: rpcError } = await supabase.rpc('add_reverse_goal_contribution', {
      p_goal_id: goalId,
      p_amount: Math.abs(Number(input.amount) || 0),
      p_occurred_on: input.occurredOn,
      p_note: String(input.note || '').trim() || null,
    })
    if (rpcError) {
      reportError(rpcError)
      return false
    }
    await load()
    return true
  }, [load, reportError])

  const updateReverseGoalContribution = useCallback(async (contributionId, input) => {
    const { error: rpcError } = await supabase.rpc('update_reverse_goal_contribution', {
      p_contribution_id: contributionId,
      p_amount: Math.abs(Number(input.amount) || 0),
      p_occurred_on: input.occurredOn,
    })
    if (rpcError) { reportError(rpcError); return false }
    await load()
    return true
  }, [load, reportError])

  const setReverseGoalRetention = useCallback(async (months) => {
    const value = months === null || months === '' ? null : Number(months)
    const { error: rpcError } = await supabase.rpc('set_reverse_goal_retention', { p_months: value })
    if (rpcError) {
      reportError(rpcError)
      return false
    }
    await load()
    return true
  }, [load, reportError])

  const updateGoal = useCallback(async (id, patch) => {
    const { error: rpcError } = await supabase.rpc('update_standard_goal_metadata', {
      p_goal_id: id,
      p_name: String(patch.name || '').trim(),
      p_target: Math.abs(Number(patch.target) || 0),
      p_deadline: patch.deadline || null,
      p_icon: patch.icon || '🎯',
      p_color: patch.color || '#6366f1',
    })
    if (rpcError) { reportError(rpcError); return false }
    await load()
    return true
  }, [load, reportError])

  const updateReverseGoal = useCallback(async (id, input) => {
    const patch = {
      name: String(input.name || '').trim(),
      icon: input.icon || '🎯',
      color: input.color || '#6366f1',
    }
    if (!patch.name) return false

    const ok = await persist(
      () => supabase.from('goals').update(patch).eq('id', id).eq('user_id', user.id).eq('goal_type', 'reverse'),
      { table: 'goals', action: 'update_reverse_metadata' },
    )
    if (!ok) return false
    await load()
    return true
  }, [load, persist, user])

  const deleteGoal = useCallback(async (id) => {
    if (!supabase || !user || deleteGoalInFlight.current) return false

    deleteGoalInFlight.current = true
    setIsDeletingGoal(true)
    setGoalDeletionPhase('deleting')
    try {
      const { error: deleteError } = await guarded(
        () => supabase.rpc('delete_goal', { p_goal_id: id }),
        { table: 'goals', action: 'delete' },
      )

      if (deleteError) {
        reportError(deleteError)
        return false
      }

      // A RPC e transacional: se ela retornou sem erro, a exclusao ja foi
      // confirmada no servidor. Leituras posteriores podem atrasar ou falhar
      // sem transformar uma meta ja excluida em um card fantasma no cliente.
      latestLoadRequest.current += 1
      setGoals((prev) => prev.filter((goal) => goal.id !== id))
      setReverseGoalHistory((prev) => prev.filter((item) => item.goal_id !== id))
      setReverseGoalContributions((prev) => prev.filter((item) => item.goal_id !== id))
      setReverseGoalEvents((prev) => prev.filter((item) => item.goal_id !== id))
      setStandardGoalContributions((prev) => prev.filter((item) => item.goal_id !== id))
      return true
    } catch (deleteException) {
      reportError(deleteException)
      return false
    } finally {
      deleteGoalInFlight.current = false
      setGoalDeletionPhase('')
      setIsDeletingGoal(false)
    }
  }, [reportError, user])

  const exportData = useCallback(() => ({
    transactions, categories, budgets, goals, standardGoalContributions,
    reverseGoalContributions, reverseGoalHistory, reverseGoalEvents,
    reverseGoalRetentionMonths,
  }), [transactions, categories, budgets, goals, standardGoalContributions, reverseGoalContributions, reverseGoalEvents, reverseGoalHistory, reverseGoalRetentionMonths])

  const importData = useCallback(async (data) => {
    if (false && Array.isArray(data.goals) && data.goals.some((goal) => goal.goalType === 'reverse' || goal.goal_type === 'reverse')) {
      reportError({ message: 'A restauração de backup com Meta Reversa requer a versão de banco compatível e foi bloqueada para evitar perda de histórico.' })
      return
    }
    const txs = Array.isArray(data.transactions) ? data.transactions.map(normalizeTransaction) : transactions
    const cats = Array.isArray(data.categories) && data.categories.length ? data.categories : categories
    const nextBudgets = data.budgets && typeof data.budgets === 'object' ? data.budgets : budgets
    const nextStandardGoalContributions = Array.isArray(data.standardGoalContributions) ? data.standardGoalContributions : []
    const nextGoals = Array.isArray(data.goals) ? data.goals.map((goal) => ({ ...goal, id: goal.id || uid(), name: String(goal.name || 'Meta'), target: Math.abs(Number(goal.target) || 0), current: Math.abs(Number(goal.current) || 0), deadline: goal.deadline || '', icon: goal.icon || '🎯', color: goal.color || '#6366f1' })) : goals

    // REQ 9 (auditoria V-05, Opcao B): uma unica RPC transacional substitui o
    // antigo delete_my_data + Promise.all. Se qualquer insert falhar, o Postgres
    // faz rollback e os dados antigos permanecem intactos.
    const payload = {
      categories: cats.map((cat) => ({
        id: cat.id,
        name: cat.name,
        icon: cat.icon || '📁',
        color: cat.color || '#6366f1',
        type: normalizeType(cat.type),
        target_percentage: Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0)),
      })),
      transactions: txs.map((tx) => toTxRow(tx, user.id)),
      // A RPC le budgets como recordset {category_id, limit_amount}; o estado
      // guarda um mapa {categoryId: valor}, entao convertemos para array.
      budgets: Object.entries(nextBudgets).map(([categoryId, amount]) => ({
        category_id: categoryId,
        limit_amount: Number(amount) || 0,
      })),
      goals: nextGoals.map((goal) => ({ ...toGoal(goal, user.id), goal_type: goal.goalType || goal.goal_type || 'standard', reverse_original_amount: goal.reverseOriginalAmount ?? goal.reverse_original_amount, reverse_remaining_amount: goal.reverseRemainingAmount ?? goal.reverse_remaining_amount, reverse_corrected_amount: goal.reverseCorrectedAmount ?? goal.reverse_corrected_amount, reverse_start_date: goal.reverseStartDate ?? goal.reverse_start_date, reverse_selic_factor: goal.reverseSelicFactor ?? goal.reverse_selic_factor, reverse_completed_at: goal.reverseCompletedAt ?? goal.reverse_completed_at, reverse_total_contributed: goal.reverseTotalContributed ?? goal.reverse_total_contributed, reverse_correction_amount: goal.reverseCorrectionAmount ?? goal.reverse_correction_amount, reverse_progress_percent: goal.reverseProgressPercent ?? goal.reverse_progress_percent, reverse_monthly_contribution_average: goal.reverseMonthlyContributionAverage ?? goal.reverse_monthly_contribution_average, reverse_forecast_completion_date: goal.reverseForecastCompletionDate ?? goal.reverse_forecast_completion_date })),
      standardGoalContributions: nextStandardGoalContributions, reverseGoalContributions: data.reverseGoalContributions || [], reverseGoalHistory: data.reverseGoalHistory || [], reverseGoalEvents: data.reverseGoalEvents || [], reverseGoalRetentionMonths: data.reverseGoalRetentionMonths ?? null,
    }

    const { error: rpcError } = await supabase.rpc('replace_my_data', { p_data: payload })
    if (rpcError) {
      reportError(rpcError)
      return
    }
    await logEvent(EVENTS.DATA_IMPORTED, 'warning', { transactions: txs.length, goals: nextGoals.length })
    await load()
  }, [budgets, categories, goals, load, reportError, transactions, user])

  const clearAll = useCallback(async () => {
    const { error: clearError } = await supabase.rpc('delete_my_data')
    if (clearError) reportError(clearError)
    await supabase.from('categories').upsert(DEFAULT_CATEGORIES.map((cat) => toCategory({ ...cat, custom: false }, user.id)))
    await load()
  }, [load, reportError, user])

  const setTransactionFormFields = useCallback((fields) => {
    const next = normalizeTransactionFormFields(fields)
    const version = ++transactionFormFieldsVersion.current
    setTransactionFormFieldsState(next)
    if (!supabase || !user) {
      setTransactionFormFieldsState(confirmedTransactionFormFields.current)
      return Promise.resolve(false)
    }

    // Cada alteracao grava o objeto inteiro, portanto as requisicoes precisam
    // ser seriadas. Sem a fila, uma resposta antiga pode sobrescrever uma
    // preferencia mais recente em redes lentas ou instaveis.
    transactionFormFieldsQueue.current = transactionFormFieldsQueue.current
      .catch(() => undefined)
      .then(async () => {
        const { error: updateError } = await guarded(
          () => supabase.from('profiles').update({ transaction_form_fields: next }).eq('id', user.id),
          { table: 'profiles', action: 'update_transaction_form_fields' },
        )
        if (updateError) {
          reportError(updateError)
          // Uma falha antiga nao pode desfazer uma alteracao mais recente que
          // ainda esteja na fila. Se esta for a ultima preferencia escolhida,
          // restaura o ultimo estado efetivamente confirmado pelo servidor.
          if (version === transactionFormFieldsVersion.current) {
            setTransactionFormFieldsState(confirmedTransactionFormFields.current)
          }
          return false
        }
        confirmedTransactionFormFields.current = next
        return true
      })

    return transactionFormFieldsQueue.current
  }, [reportError, user])

  return { transactions, categories, budgets, goals, theme, transactionFormFields, loading, error, isDeletingGoal, goalDeletionPhase, reload: load,
    addTransaction, updateTransaction, deleteTransaction, duplicateTransaction, togglePaid,
    addCategory, updateCategory, deleteCategory, setBudget, addGoal, addReverseGoal, addReverseGoalContribution, updateReverseGoalContribution, addStandardGoalContribution, updateStandardGoalContribution, updateGoal, updateReverseGoal, deleteGoal,
    reverseGoalHistory, reverseGoalContributions, standardGoalContributions, reverseGoalEvents, reverseGoalRetentionMonths,
    setReverseGoalRetention,
    setTheme, setTransactionFormFields, exportData, importData, clearAll }
}
