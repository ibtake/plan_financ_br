import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { guarded } from '../lib/audit.js'
import { offlineDb } from '../lib/offlineDb.js'
import { isCurrentLoad } from '../lib/offlineRevalidation.js'
import { supabase, translateAuthError } from '../lib/supabase.js'

const STORAGE_KEY = 'aporte-certo:v1'

function fromRow(row) {
  return { year: Number(row.year), months: row.months || [], premise: row.premise || {}, params: row.fiscal_params || {} }
}

export function usePGBL() {
  const { user, sessionRevision, offlineCacheEnabled } = useAuth()
  const [plans, setPlans] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pending = useRef(new Map())
  const planVersions = useRef(new Map())
  const confirmedPlans = useRef({})
  const latestLoadRequest = useRef(0)
  const currentUserId = useRef(user?.id || null)
  const currentSessionRevision = useRef(sessionRevision)
  const initializedUser = useRef(null)
  currentUserId.current = user?.id || null
  currentSessionRevision.current = sessionRevision

  const load = useCallback(async ({ hydrate = false, preserveLoading = true } = {}) => {
    const requestId = ++latestLoadRequest.current
    const captured = { requestId, userId: user?.id || null, sessionRevision }
    const stillCurrent = () => isCurrentLoad(captured, {
      requestId: latestLoadRequest.current,
      userId: currentUserId.current,
      sessionRevision: currentSessionRevision.current,
    })
    if (!user || !supabase) { setLoading(false); return }
    let hydrated = false
    if (hydrate && initializedUser.current !== user.id) {
      initializedUser.current = user.id
      if (offlineCacheEnabled) {
        const cached = await offlineDb.readSnapshots(user.id, ['pgblPlans'])
        if (!stillCurrent()) return false
        if (cached.data?.pgblPlans) {
          confirmedPlans.current = cached.data.pgblPlans
          setPlans(cached.data.pgblPlans)
          setLoading(false)
          hydrated = true
        }
      }
    }
    if (!preserveLoading && !hydrated) setLoading(true)
    // Erro de uma tentativa anterior nao sobrevive a uma recarga bem-sucedida:
    // `load` sai como `reload` (:135) e e refeito no retorno de aba
    // (AuthContext.jsx:154).
    setError('')
    let result
    try {
      result = await guarded(() => supabase.from('pgbl_plans').select('*').order('year', { ascending: false }), { table: 'pgbl_plans', action: 'select' })
    } catch (loadError) {
      result = { error: loadError }
    }
    if (!stillCurrent()) return false
    if (result.error) { setError(translateAuthError(result.error)); setLoading(false); return false }
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
    if (!stillCurrent()) return false
    confirmedPlans.current = next
    setPlans(next)
    setLoading(false)
    await offlineDb.writeSnapshots(user.id, { pgblPlans: next }, Date.now())
    return true
  }, [offlineCacheEnabled, sessionRevision, user])

  useEffect(() => {
    for (const { timer } of pending.current.values()) window.clearTimeout(timer)
    pending.current.clear()
    planVersions.current.clear()
    confirmedPlans.current = {}
    setPlans({})
    setError('')
  }, [user?.id])

  useEffect(() => {
    const initial = initializedUser.current !== user?.id
    if (!user) initializedUser.current = null
    void load({ hydrate: initial, preserveLoading: !initial })
  }, [load, user])

  /** Grava um plano. Compartilhada pelo debounce e pelo flush de saida. */
  const writePlan = useCallback(async (payload, previous, version) => {
    let result
    try {
      result = await guarded(() => supabase.from('pgbl_plans').upsert(payload).select().single(), { table: 'pgbl_plans', action: 'upsert' })
    } catch (writeError) {
      result = { error: writeError }
    }
    // Limpa no sucesso, e nao por temporizador: o debounce de 450 ms grava a cada
    // pausa da digitacao, entao uma falha passageira de rede deixaria o aviso
    // vermelho na tela por toda a edicao seguinte e o usuario nao teria como saber
    // se o plano esta salvo. `setError('')` com o estado ja vazio nao re-renderiza
    // (React compara por Object.is), logo nao custa nada no caso comum.
    setError(result.error ? translateAuthError(result.error) : '')
    if (result.error && planVersions.current.get(payload.year) === version) {
      setPlans((current) => {
        const next = { ...current }
        if (previous) next[payload.year] = previous
        else delete next[payload.year]
        return next
      })
    } else if (!result.error && result.data) {
      const confirmed = fromRow(result.data)
      confirmedPlans.current = { ...confirmedPlans.current, [payload.year]: confirmed }
      if (planVersions.current.get(payload.year) === version) {
        setPlans((current) => ({ ...current, [payload.year]: confirmed }))
      }
      await offlineDb.writeSnapshots(payload.user_id, { pgblPlans: confirmedPlans.current }, Date.now())
    }
  }, [])

  // Descarrega o debounce quando a aba vai para segundo plano: e o unico momento
  // com sinal de saida E sessao ainda valida. Cobre trocar de aba do navegador,
  // minimizar e o app em segundo plano no celular; os navegadores atuais disparam
  // `hidden` antes de `pagehide`, entao pega tambem a maior parte dos fechamentos.
  // Num fechamento seco o fetch em voo ainda pode ser abortado - garantir exigiria
  // `keepalive`, que o supabase-js nao expoe por requisicao (so embrulhando
  // `global.fetch` em lib/supabase.js). AuthContext.jsx:224-227 ja escuta este
  // evento na direcao oposta, `visible`.
  //
  // O cleanup abaixo NAO grava, de proposito. Ele roda em logout, sessao expirada
  // e MFA exigido, e nesses tres a politica de `pgbl_plans` ja recusa: o
  // AuthContext chama `supabase.auth.signOut()` antes de derrubar a sessao, e
  // `with check (auth.uid()=user_id and is_token_valid() and has_required_aal())`
  // (schema.sql:1019) devolve 42501 sem token. Gravar ali seria requisicao
  // recusada em todo logout com edicao pendente.
  useEffect(() => {
    const pendingPlans = pending.current
    const flush = () => {
      if (document.visibilityState !== 'hidden') return
      const entries = [...pendingPlans.values()]
      pendingPlans.clear()
      for (const { timer, payload, previous, version } of entries) {
        window.clearTimeout(timer)
        void writePlan(payload, previous, version)
      }
    }
    document.addEventListener('visibilitychange', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      for (const { timer } of pendingPlans.values()) window.clearTimeout(timer)
      pendingPlans.clear()
    }
  }, [writePlan])

  const savePlan = useCallback((plan) => {
    const pendingEntry = pending.current.get(plan.year)
    const previous = confirmedPlans.current[plan.year]
    const version = (planVersions.current.get(plan.year) || 0) + 1
    planVersions.current.set(plan.year, version)
    setPlans((current) => ({ ...current, [plan.year]: plan }))
    if (!user || !supabase) {
      setPlans((current) => {
        const next = { ...current }
        if (previous) next[plan.year] = previous
        else delete next[plan.year]
        return next
      })
      return
    }
    if (pendingEntry) window.clearTimeout(pendingEntry.timer)
    const payload = { user_id: user.id, year: plan.year, months: plan.months, premise: plan.premise, fiscal_params: plan.params }
    const timer = window.setTimeout(() => {
      // Sai do mapa ANTES da escrita: com o delete depois do await, uma entrada
      // de timer ja disparado seguiria visivel para o flush, que repetiria o
      // mesmo upsert enquanto o primeiro estivesse em voo.
      pending.current.delete(plan.year)
      void writePlan(payload, previous, version)
    }, 450)
    pending.current.set(plan.year, { timer, payload, previous, version })
  }, [user, writePlan])

  const deletePlan = useCallback(async (year) => {
    if (!user || !supabase) return false
    // Sai do mapa, nao basta cancelar o timer: uma entrada orfa com payload seria
    // regravada pelo flush de saida e ressuscitaria o plano recem-excluido.
    const entry = pending.current.get(year)
    if (entry) {
      window.clearTimeout(entry.timer)
      pending.current.delete(year)
    }
    const previous = confirmedPlans.current[year]
    const version = (planVersions.current.get(year) || 0) + 1
    planVersions.current.set(year, version)
    setPlans((current) => {
      const next = { ...current }
      delete next[year]
      return next
    })
    let result
    try {
      result = await guarded(() => supabase.from('pgbl_plans').delete().eq('user_id', user.id).eq('year', year), { table: 'pgbl_plans', action: 'delete' })
    } catch (deleteError) {
      result = { error: deleteError }
    }
    if (result.error) {
      if (previous && planVersions.current.get(year) === version) setPlans((current) => ({ ...current, [year]: previous }))
      setError(translateAuthError(result.error))
      return false
    }
    const nextConfirmed = { ...confirmedPlans.current }
    delete nextConfirmed[year]
    confirmedPlans.current = nextConfirmed
    await offlineDb.writeSnapshots(user.id, { pgblPlans: nextConfirmed }, Date.now())
    setError('')
    return true
  }, [user])

  return { plans, loading, error, savePlan, deletePlan, reload: load }
}
