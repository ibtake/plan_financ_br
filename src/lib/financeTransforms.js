import { normalizeType } from '../utils/categories.js'
import { uid } from '../utils/format.js'

export function normalizeTransaction(input) {
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

export const toTxRow = (tx, userId) => ({
  id: tx.id, user_id: userId, type: tx.type, description: tx.description, amount: tx.amount,
  category_id: tx.categoryId, date: tx.date, method: tx.method, paid: tx.paid,
  recurrence: tx.recurrence, recurrence_end: tx.recurrenceEnd || null, installments: tx.installments,
  tags: tx.tags, note: tx.note || null, paid_occurrences: tx.paidOccurrences, created_at: tx.createdAt,
})

export const fromTxRow = (row) => normalizeTransaction({
  id: row.id, type: row.type, description: row.description, amount: Number(row.amount),
  categoryId: row.category_id, date: row.date, method: row.method, paid: row.paid,
  recurrence: row.recurrence, recurrenceEnd: row.recurrence_end || '', installments: row.installments,
  tags: row.tags || [], note: row.note || '', paidOccurrences: row.paid_occurrences || {}, createdAt: row.created_at,
})

export const fromCategory = (row) => ({
  id: row.id, name: row.name, type: row.type, color: row.color, icon: row.icon,
  targetPercentage: Number(row.target_percentage) || 0, custom: row.custom,
})

export const toCategory = (cat, userId) => ({
  id: cat.id, user_id: userId, name: cat.name, type: cat.type, color: cat.color, icon: cat.icon,
  target_percentage: Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0)), custom: cat.custom !== false,
})

export const fromGoal = (row) => ({
  id: row.id, name: row.name, target: Number(row.target), current: Number(row.current),
  deadline: row.deadline || '', icon: row.icon, color: row.color, goalType: row.goal_type || 'standard',
  reverseOriginalAmount: Number(row.reverse_original_amount) || 0,
  reverseRemainingAmount: Number(row.reverse_remaining_amount) || 0,
  reverseCorrectedAmount: Number(row.reverse_corrected_amount) || 0,
  reverseTotalContributed: Number(row.reverse_total_contributed) || 0,
  reverseCorrectionAmount: Number(row.reverse_correction_amount) || 0,
  reverseProgressPercent: Number(row.reverse_progress_percent) || 0,
  reverseForecastCompletionDate: row.reverse_forecast_completion_date || null,
  reverseMonthlyContributionAverage: Number(row.reverse_monthly_contribution_average || 0),
  reverseStartDate: row.reverse_start_date || '', reverseSelicFactor: Number(row.reverse_selic_factor) || 1,
  reverseCompletedAt: row.reverse_completed_at || null,
})

export const toGoal = (goal, userId) => ({
  id: goal.id, user_id: userId, name: goal.name, target: goal.target, current: goal.current,
  deadline: goal.deadline || null, icon: goal.icon, color: goal.color,
})
