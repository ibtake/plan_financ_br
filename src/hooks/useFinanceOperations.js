import { useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { fromTxRow, normalizeTransaction, toCategory, toTxRow } from '../lib/financeTransforms.js'
import { fallbackCategoryId, normalizeType } from '../utils/categories.js'
import { uid } from '../utils/format.js'

export function useFinanceOperations({ persist, user, transactions, categories, setTransactions, setCategories, setBudgets, reportError, transactionInsertInFlight, categoryInsertInFlight }) {
  const addTransaction = useCallback((input) => {
    if (transactionInsertInFlight.current) return null
    transactionInsertInFlight.current = true
    try {
      const tx = normalizeTransaction(input)
      setTransactions((prev) => [tx, ...prev])
      void persist(() => supabase.from('transactions').insert(toTxRow(tx, user.id)), { table: 'transactions', action: 'insert' })
        .finally(() => { transactionInsertInFlight.current = false })
      return tx
    } catch (error) {
      transactionInsertInFlight.current = false
      throw error
    }
  }, [persist, setTransactions, transactionInsertInFlight, user])

  const updateTransaction = useCallback((id, input, occurrenceIndex = 0) => {
    const rootId = String(id).split('#')[0]
    const patch = Number(occurrenceIndex) > 0
      ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'date' && key !== 'paid'))
      : input
    const current = transactions.find((tx) => tx.id === rootId)
    if (!current) return
    const updated = normalizeTransaction({ ...current, ...patch, id: rootId })
    setTransactions((prev) => prev.map((tx) => (tx.id === rootId ? updated : tx)))
    void persist(() => supabase.from('transactions').update(toTxRow(updated, user.id)).eq('id', rootId).eq('user_id', user.id), { table: 'transactions', action: 'update' })
  }, [persist, setTransactions, transactions, user])

  const deleteTransaction = useCallback((id) => {
    const rootId = String(id).split('#')[0]
    setTransactions((prev) => prev.filter((tx) => tx.id !== rootId))
    void persist(() => supabase.from('transactions').delete().eq('id', rootId).eq('user_id', user.id), { table: 'transactions', action: 'delete' })
  }, [persist, setTransactions, user])

  const duplicateTransaction = useCallback((occurrence) => addTransaction({
    ...occurrence, id: uid(), description: `${occurrence.description} (cópia)`, recurrence: 'none',
    installments: 1, paidOccurrences: {}, createdAt: new Date().toISOString(),
  }), [addTransaction])

  const togglePaid = useCallback((occurrence) => {
    const rootId = occurrence.sourceId || String(occurrence.id).split('#')[0]
    const index = occurrence.occurrenceIndex || 0
    void persist(async () => {
      const result = await supabase.rpc('toggle_paid_occurrence', { p_transaction_id: rootId, p_occurrence_index: index })
      if (!result.error && result.data) {
        const updated = fromTxRow(result.data)
        setTransactions((prev) => prev.map((tx) => tx.id === rootId ? updated : tx))
      }
      return result
    }, { table: 'transactions', action: 'toggle_paid' })
  }, [persist, setTransactions])

  const addCategory = useCallback((input) => {
    if (categoryInsertInFlight.current) return
    categoryInsertInFlight.current = true
    try {
      const base = String(input.name || 'cat').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const cat = { id: input.id || `${base}-${crypto.randomUUID().slice(0, 8)}`, name: String(input.name || 'Nova categoria').trim(), type: normalizeType(input.type), color: input.color || '#6366f1', icon: input.icon || '📁', targetPercentage: Math.max(0, Math.min(100, Number(input.targetPercentage) || 0)), custom: true }
      setCategories((prev) => [...prev, cat])
      void persist(() => supabase.from('categories').insert(toCategory(cat, user.id)), { table: 'categories', action: 'insert' })
        .finally(() => { categoryInsertInFlight.current = false })
    } catch (error) {
      categoryInsertInFlight.current = false
      throw error
    }
  }, [categoryInsertInFlight, persist, setCategories, user])

  const updateCategory = useCallback((id, patch) => {
    setCategories((prev) => prev.map((cat) => cat.id === id ? { ...cat, ...patch } : cat))
    const allowed = {}
    if (patch.name !== undefined) allowed.name = patch.name
    if (patch.type !== undefined) allowed.type = normalizeType(patch.type)
    if (patch.color !== undefined) allowed.color = patch.color
    if (patch.icon !== undefined) allowed.icon = patch.icon
    if (patch.targetPercentage !== undefined) allowed.target_percentage = Math.max(0, Math.min(100, Number(patch.targetPercentage) || 0))
    void persist(() => supabase.from('categories').update(allowed).eq('id', id).eq('user_id', user.id), { table: 'categories', action: 'update' })
  }, [persist, setCategories, user])

  const deleteCategory = useCallback((id) => {
    const category = categories.find((cat) => cat.id === id)
    const fallback = categories.find((cat) => cat.id === fallbackCategoryId(category?.type)) || categories.find((cat) => cat.type === category?.type && cat.id !== id)
    if (!category || !fallback) {
      reportError({ message: 'Mantenha pelo menos uma categoria deste tipo para realocar os lançamentos.' })
      return
    }
    const fallbackId = fallback.id
    setCategories((prev) => prev.filter((cat) => cat.id !== id))
    setBudgets((prev) => { const next = { ...prev }; delete next[id]; return next })
    setTransactions((prev) => prev.map((tx) => tx.categoryId === id ? { ...tx, categoryId: fallbackId } : tx))
    void (async () => {
      const okTx = await persist(() => supabase.from('transactions').update({ category_id: fallbackId }).eq('category_id', id).eq('user_id', user.id), { table: 'transactions', action: 'update_category' })
      const okBudget = await persist(() => supabase.from('budgets').delete().eq('category_id', id).eq('user_id', user.id), { table: 'budgets', action: 'delete' })
      if (okTx && okBudget) await persist(() => supabase.from('categories').delete().eq('id', id).eq('user_id', user.id), { table: 'categories', action: 'delete' })
    })()
  }, [categories, persist, reportError, setBudgets, setCategories, setTransactions, user])

  const setBudget = useCallback((categoryId, limit) => {
    const amount = Number(limit) || 0
    setBudgets((prev) => { const next = { ...prev }; if (amount <= 0) delete next[categoryId]; else next[categoryId] = amount; return next })
    if (amount <= 0) void persist(() => supabase.from('budgets').delete().eq('category_id', categoryId).eq('user_id', user.id), { table: 'budgets', action: 'delete' })
    else void persist(() => supabase.from('budgets').upsert({ user_id: user.id, category_id: categoryId, limit_amount: amount }), { table: 'budgets', action: 'upsert' })
  }, [persist, setBudgets, user])

  return { addTransaction, updateTransaction, deleteTransaction, duplicateTransaction, togglePaid, addCategory, updateCategory, deleteCategory, setBudget }
}
