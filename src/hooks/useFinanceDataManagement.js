import { useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { EVENTS, logEvent } from '../lib/audit.js'
import { toGoal, toTxRow, normalizeTransaction } from '../lib/financeTransforms.js'
import { normalizeType } from '../utils/categories.js'
import { uid } from '../utils/format.js'
import { RECURRENCE_END_ERROR, recurrenceEndBeforeStart } from '../utils/recurrence.js'
import { normalizeTransactionFormFields } from '../utils/transactionFormFields.js'

export function useFinanceDataManagement({ transactions, categories, budgets, goals, standardGoalContributions, reverseGoalContributions, reverseGoalHistory, reverseGoalEvents, reverseGoalRetentionMonths, setTransactionFormFieldsState, confirmedTransactionFormFields, transactionFormFieldsQueue, transactionFormFieldsVersion, load, guarded: guardedFromHook, reportError, user }) {
  const exportData = useCallback(() => ({
    transactions, categories, budgets, goals, standardGoalContributions,
    reverseGoalContributions, reverseGoalHistory, reverseGoalEvents,
    reverseGoalRetentionMonths,
  }), [transactions, categories, budgets, goals, standardGoalContributions, reverseGoalContributions, reverseGoalHistory, reverseGoalEvents, reverseGoalRetentionMonths])

  const importData = useCallback(async (data, pgblPlans = data?.pgblPlans) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      reportError({ message: 'Backup inválido.' })
      return false
    }
    if (!supabase || !user) {
      reportError({ message: 'Sessão expirada. Entre novamente para importar o backup.' })
      return false
    }
    const badEnd = (Array.isArray(data.transactions) ? data.transactions : []).find(recurrenceEndBeforeStart)
    if (badEnd) {
      reportError({ message: `${RECURRENCE_END_ERROR} Corrija "${String(badEnd.description || 'sem descrição').slice(0, 60)}" no arquivo e importe de novo.` })
      return false
    }
    try {
      const txs = Array.isArray(data.transactions) ? data.transactions.map(normalizeTransaction) : transactions
      const cats = Array.isArray(data.categories) && data.categories.length ? data.categories : categories
      const nextBudgets = data.budgets && typeof data.budgets === 'object' ? data.budgets : budgets
      const nextStandardGoalContributions = Array.isArray(data.standardGoalContributions) ? data.standardGoalContributions : undefined
      const nextGoals = Array.isArray(data.goals) ? data.goals.map((goal) => ({ ...goal, id: goal.id || uid(), name: String(goal.name || 'Meta'), target: Math.abs(Number(goal.target) || 0), current: Math.abs(Number(goal.current) || 0), deadline: goal.deadline || '', icon: goal.icon || '🎯', color: goal.color || '#6366f1' })) : goals
      const payload = {
        categories: cats.map((cat) => ({ id: cat.id, name: cat.name, icon: cat.icon || '📁', color: cat.color || '#6366f1', type: normalizeType(cat.type), target_percentage: Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0)) })),
        transactions: txs.map((tx) => toTxRow(tx, user.id)),
        budgets: Object.entries(nextBudgets).map(([categoryId, amount]) => ({ category_id: categoryId, limit_amount: Number(amount) || 0 })),
        goals: nextGoals.map((goal) => ({ ...toGoal(goal, user.id), goal_type: goal.goalType || goal.goal_type || 'standard', reverse_original_amount: goal.reverseOriginalAmount ?? goal.reverse_original_amount, reverse_remaining_amount: goal.reverseRemainingAmount ?? goal.reverse_remaining_amount, reverse_corrected_amount: goal.reverseCorrectedAmount ?? goal.reverse_corrected_amount, reverse_start_date: goal.reverseStartDate ?? goal.reverse_start_date, reverse_selic_factor: goal.reverseSelicFactor ?? goal.reverse_selic_factor, reverse_completed_at: goal.reverseCompletedAt ?? goal.reverse_completed_at, reverse_total_contributed: goal.reverseTotalContributed ?? goal.reverse_total_contributed, reverse_correction_amount: goal.reverseCorrectionAmount ?? goal.reverse_correction_amount, reverse_progress_percent: goal.reverseProgressPercent ?? goal.reverse_progress_percent, reverse_monthly_contribution_average: goal.reverseMonthlyContributionAverage ?? goal.reverse_monthly_contribution_average, reverse_forecast_completion_date: goal.reverseForecastCompletionDate ?? goal.reverse_forecast_completion_date })),
        standardGoalContributions: nextStandardGoalContributions,
        reverseGoalContributions: Array.isArray(data.reverseGoalContributions) ? data.reverseGoalContributions : reverseGoalContributions,
        reverseGoalHistory: Array.isArray(data.reverseGoalHistory) ? data.reverseGoalHistory : reverseGoalHistory,
        reverseGoalEvents: Array.isArray(data.reverseGoalEvents) ? data.reverseGoalEvents : reverseGoalEvents,
        reverseGoalRetentionMonths: data.reverseGoalRetentionMonths === undefined ? reverseGoalRetentionMonths : data.reverseGoalRetentionMonths,
        pgblPlans: (Array.isArray(pgblPlans) ? pgblPlans : []).map((plan) => ({ year: Number(plan.year), months: plan.months || [], premise: plan.premise || {}, fiscal_params: plan.fiscal_params ?? plan.params ?? {} })),
      }
      const { error: rpcError } = await guardedFromHook(() => supabase.rpc('replace_my_data', { p_data: payload }), { table: 'user_data', action: 'import' })
      if (rpcError) {
        reportError(rpcError)
        return false
      }
      await logEvent(EVENTS.DATA_IMPORTED, 'warning', { transactions: txs.length, goals: nextGoals.length })
    } catch (error) {
      reportError(error)
      return false
    }
    await load({ preserveLoading: true })
    return true
  }, [budgets, categories, goals, guardedFromHook, load, reportError, reverseGoalContributions, reverseGoalEvents, reverseGoalHistory, reverseGoalRetentionMonths, transactions, user])

  const clearAll = useCallback(async () => {
    if (!supabase || !user) return false
    try {
      const { error } = await guardedFromHook(() => supabase.rpc('reset_my_data_with_defaults'), { table: 'user_data', action: 'reset_with_defaults' })
      if (error) {
        reportError(error)
        return false
      }
      await load({ preserveLoading: true })
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }, [guardedFromHook, load, reportError, user])

  const setTransactionFormFields = useCallback((fields) => {
    const next = normalizeTransactionFormFields(fields)
    const version = ++transactionFormFieldsVersion.current
    setTransactionFormFieldsState(next)
    if (!supabase || !user) {
      setTransactionFormFieldsState(confirmedTransactionFormFields.current)
      return Promise.resolve(false)
    }
    transactionFormFieldsQueue.current = transactionFormFieldsQueue.current
      .catch(() => undefined)
      .then(async () => {
        const { error: updateError } = await guardedFromHook(() => supabase.from('profiles').update({ transaction_form_fields: next }).eq('id', user.id), { table: 'profiles', action: 'update_transaction_form_fields' })
        if (updateError) {
          reportError(updateError)
          if (version === transactionFormFieldsVersion.current) setTransactionFormFieldsState(confirmedTransactionFormFields.current)
          return false
        }
        confirmedTransactionFormFields.current = next
        return true
      })
    return transactionFormFieldsQueue.current
  }, [confirmedTransactionFormFields, guardedFromHook, reportError, setTransactionFormFieldsState, transactionFormFieldsQueue, transactionFormFieldsVersion, user])

  return { exportData, importData, clearAll, setTransactionFormFields }
}
