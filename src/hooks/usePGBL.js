import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { guarded } from '../lib/audit.js'
import { supabase, translateAuthError } from '../lib/supabase.js'

const STORAGE_KEY = 'aporte-certo:v1'

function fromRow(row) {
  return { year: Number(row.year), months: row.months || [], premise: row.premise || {}, params: row.fiscal_params || {} }
}

export function usePGBL() {
  const { user } = useAuth()
  const [plans, setPlans] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef(new Map())

  const load = useCallback(async () => {
    if (!user || !supabase) { setLoading(false); return }
    setLoading(true)
    const result = await guarded(() => supabase.from('pgbl_plans').select('*').order('year', { ascending: false }), { table: 'pgbl_plans', action: 'select' })
    if (result.error) { setError(translateAuthError(result.error)); setLoading(false); return }
    const next = Object.fromEntries((result.data || []).map((row) => [row.year, fromRow(row)]))
    // Migra uma eventual versao local somente quando a conta ainda nao tem planos.
    if (!Object.keys(next).length) {
      try {
        const local = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
        const localPlans = local?.years || (local?.year ? { [local.year]: local } : {})
        for (const plan of Object.values(localPlans)) {
          const year = Number(plan.year || Object.keys(localPlans).find((key) => localPlans[key] === plan))
          if (!year) continue
          const payload = { user_id: user.id, year, months: plan.months || [], premise: plan.premise || {}, fiscal_params: plan.params || {} }
          const saved = await guarded(() => supabase.from('pgbl_plans').upsert(payload).select().single(), { table: 'pgbl_plans', action: 'migrate_local' })
          if (!saved.error) next[year] = fromRow(saved.data)
        }
        if (Object.keys(next).length) window.localStorage.removeItem(STORAGE_KEY)
      } catch { /* localStorage indisponivel ou dados antigos invalidos */ }
    }
    setPlans(next)
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])

  const savePlan = useCallback((plan) => {
    setPlans((current) => ({ ...current, [plan.year]: plan }))
    if (!user || !supabase) return
    const oldTimer = pending.current.get(plan.year)
    if (oldTimer) window.clearTimeout(oldTimer)
    const timer = window.setTimeout(async () => {
      const result = await guarded(() => supabase.from('pgbl_plans').upsert({ user_id: user.id, year: plan.year, months: plan.months, premise: plan.premise, fiscal_params: plan.params }).select().single(), { table: 'pgbl_plans', action: 'upsert' })
      if (result.error) setError(translateAuthError(result.error))
      pending.current.delete(plan.year)
    }, 450)
    pending.current.set(plan.year, timer)
  }, [user])

  const deletePlan = useCallback(async (year) => {
    if (!user || !supabase) return false
    const timer = pending.current.get(year)
    if (timer) window.clearTimeout(timer)
    const previous = plans[year]
    setPlans((current) => {
      const next = { ...current }
      delete next[year]
      return next
    })
    const result = await guarded(() => supabase.from('pgbl_plans').delete().eq('user_id', user.id).eq('year', year), { table: 'pgbl_plans', action: 'delete' })
    if (result.error) {
      if (previous) setPlans((current) => ({ ...current, [year]: previous }))
      setError(translateAuthError(result.error))
      return false
    }
    return true
  }, [plans, user])

  return { plans, loading, error, savePlan, deletePlan }
}
