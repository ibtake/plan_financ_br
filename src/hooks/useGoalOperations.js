import { useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

export function useGoalOperations({ load, persist, guarded, reportError, user, deleteGoalInFlight, latestLoadRequest, setGoals, setReverseGoalHistory, setReverseGoalContributions, setStandardGoalContributions, setReverseGoalEvents, setIsDeletingGoal, setGoalDeletionPhase }) {
  const callGoalRpc = useCallback(async (operation, action) => {
    try {
      const result = await guarded(operation, { table: 'goals', action })
      if (result?.error) {
        reportError(result.error)
        return false
      }
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }, [guarded, reportError])

  const runGoalRpc = useCallback(async (operation, action) => {
    const ok = await callGoalRpc(operation, action)
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const addGoal = useCallback((input) => runGoalRpc(() => supabase.rpc('create_standard_goal', {
    p_name: String(input.name || '').trim(), p_target: Math.abs(Number(input.target) || 0),
    p_initial_contribution: Math.abs(Number(input.current) || 0), p_deadline: input.deadline || null,
    p_icon: input.icon || '🎯', p_color: input.color || '#6366f1',
  }), 'create_standard'), [runGoalRpc])

  const addStandardGoalContribution = useCallback((goalId, input) => runGoalRpc(() => supabase.rpc('add_standard_goal_contribution', {
    p_goal_id: goalId, p_amount: Math.abs(Number(input.amount) || 0), p_occurred_on: input.occurredOn,
  }), 'add_standard_contribution'), [runGoalRpc])

  const updateStandardGoalContribution = useCallback((contributionId, input) => runGoalRpc(() => supabase.rpc('update_standard_goal_contribution', {
    p_contribution_id: contributionId, p_amount: Math.abs(Number(input.amount) || 0), p_occurred_on: input.occurredOn,
  }), 'update_standard_contribution'), [runGoalRpc])

  const addReverseGoal = useCallback((input) => runGoalRpc(() => supabase.rpc('create_reverse_goal', {
    p_name: String(input.name || '').trim(), p_original_amount: Math.abs(Number(input.originalAmount) || 0),
    p_initial_contribution: Math.abs(Number(input.initialContribution) || 0), p_start_date: input.startDate,
    p_selic_factor: Number(input.selicFactor) || 1, p_icon: input.icon || '🎯', p_color: input.color || '#6366f1',
  }), 'create_reverse'), [runGoalRpc])

  const addReverseGoalContribution = useCallback((goalId, input) => runGoalRpc(() => supabase.rpc('add_reverse_goal_contribution', {
    p_goal_id: goalId, p_amount: Math.abs(Number(input.amount) || 0), p_occurred_on: input.occurredOn,
    p_note: String(input.note || '').trim() || null,
  }), 'add_reverse_contribution'), [runGoalRpc])

  const updateReverseGoalContribution = useCallback((contributionId, input) => runGoalRpc(() => supabase.rpc('update_reverse_goal_contribution', {
    p_contribution_id: contributionId, p_amount: Math.abs(Number(input.amount) || 0), p_occurred_on: input.occurredOn,
  }), 'update_reverse_contribution'), [runGoalRpc])

  const setReverseGoalRetention = useCallback((months) => {
    const value = months === null || months === '' ? null : Number(months)
    return runGoalRpc(() => supabase.rpc('set_reverse_goal_retention', { p_months: value }), 'set_reverse_retention')
  }, [runGoalRpc])

  const updateGoal = useCallback((id, patch) => runGoalRpc(() => supabase.rpc('update_standard_goal_metadata', {
    p_goal_id: id, p_name: String(patch.name || '').trim(), p_target: Math.abs(Number(patch.target) || 0),
    p_deadline: patch.deadline || null, p_icon: patch.icon || '🎯', p_color: patch.color || '#6366f1',
  }), 'update_standard_metadata'), [runGoalRpc])

  const updateReverseGoal = useCallback(async (id, input) => {
    const patch = { name: String(input.name || '').trim(), icon: input.icon || '🎯', color: input.color || '#6366f1' }
    if (!patch.name) return false
    const ok = await persist(() => supabase.from('goals').update(patch).eq('id', id).eq('user_id', user.id).eq('goal_type', 'reverse'), { table: 'goals', action: 'update_reverse_metadata' })
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [load, persist, user])

  const deleteGoal = useCallback(async (id) => {
    if (!supabase || !user || deleteGoalInFlight.current) return false
    deleteGoalInFlight.current = true
    setIsDeletingGoal(true)
    setGoalDeletionPhase('deleting')
    try {
      const { error: deleteError } = await guarded(() => supabase.rpc('delete_goal', { p_goal_id: id }), { table: 'goals', action: 'delete' })
      if (deleteError) {
        reportError(deleteError)
        return false
      }
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
  }, [deleteGoalInFlight, guarded, latestLoadRequest, reportError, setGoalDeletionPhase, setGoals, setIsDeletingGoal, setReverseGoalContributions, setReverseGoalEvents, setReverseGoalHistory, setStandardGoalContributions, user])

  return { addGoal, addStandardGoalContribution, updateStandardGoalContribution, addReverseGoal, addReverseGoalContribution, updateReverseGoalContribution, setReverseGoalRetention, updateGoal, updateReverseGoal, deleteGoal }
}
