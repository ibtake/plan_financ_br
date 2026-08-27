const readList = (supabase, guarded, selectAllPages, table, apply = (query) => query) => selectAllPages((from, to) => guarded(
  () => apply(supabase.from(table).select('*', { count: 'exact' })).range(from, to),
  { table, action: 'select' },
))

export function loadFinanceData({ supabase, guarded, selectAllPages }) {
  const profileRequest = guarded(
    () => supabase.from('profiles').select('transaction_form_fields').maybeSingle(),
    { table: 'profiles', action: 'select_transaction_form_fields' },
  )
  const supportingDataRequest = Promise.all([
    readList(supabase, guarded, selectAllPages, 'reverse_goal_history', (query) => query.order('reference_month', { ascending: false }).order('id', { ascending: false })),
    readList(supabase, guarded, selectAllPages, 'reverse_goal_contributions', (query) => query.order('occurred_on', { ascending: false }).order('id', { ascending: false })),
    readList(supabase, guarded, selectAllPages, 'standard_goal_contributions', (query) => query.order('occurred_on', { ascending: false }).order('id', { ascending: false })),
    readList(supabase, guarded, selectAllPages, 'reverse_goal_events', (query) => query.order('occurred_on', { ascending: false }).order('id', { ascending: false })),
    guarded(() => supabase.from('reverse_goal_retention_settings').select('completed_goal_retention_months').maybeSingle(), { table: 'reverse_goal_retention_settings', action: 'select' }),
  ])
  const primaryDataRequest = Promise.all([
    readList(supabase, guarded, selectAllPages, 'transactions', (query) => query.order('created_at', { ascending: false }).order('id', { ascending: false })),
    readList(supabase, guarded, selectAllPages, 'categories', (query) => query.order('created_at').order('id')),
    readList(supabase, guarded, selectAllPages, 'budgets', (query) => query.order('category_id')),
    readList(supabase, guarded, selectAllPages, 'goals', (query) => query.order('created_at').order('id')),
  ])
  return { profileRequest, supportingDataRequest, primaryDataRequest }
}
