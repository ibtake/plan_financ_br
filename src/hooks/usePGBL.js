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
    // Erro de uma tentativa anterior nao sobrevive a uma recarga bem-sucedida:
    // `load` sai como `reload` (:135) e e refeito no retorno de aba
    // (AuthContext.jsx:154).
    setError('')
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

  /** Grava um plano. Compartilhada pelo debounce e pelo flush de saida. */
  const writePlan = useCallback(async (payload) => {
    const result = await guarded(() => supabase.from('pgbl_plans').upsert(payload).select().single(), { table: 'pgbl_plans', action: 'upsert' })
    // Limpa no sucesso, e nao por temporizador: o debounce de 450 ms grava a cada
    // pausa da digitacao, entao uma falha passageira de rede deixaria o aviso
    // vermelho na tela por toda a edicao seguinte e o usuario nao teria como saber
    // se o plano esta salvo. `setError('')` com o estado ja vazio nao re-renderiza
    // (React compara por Object.is), logo nao custa nada no caso comum.
    setError(result.error ? translateAuthError(result.error) : '')
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
    const flush = () => {
      if (document.visibilityState !== 'hidden') return
      const entries = [...pending.current.values()]
      pending.current.clear()
      for (const { timer, payload } of entries) {
        window.clearTimeout(timer)
        void writePlan(payload)
      }
    }
    document.addEventListener('visibilitychange', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      for (const { timer } of pending.current.values()) window.clearTimeout(timer)
      pending.current.clear()
    }
  }, [writePlan])

  const savePlan = useCallback((plan) => {
    setPlans((current) => ({ ...current, [plan.year]: plan }))
    if (!user || !supabase) return
    const previous = pending.current.get(plan.year)
    if (previous) window.clearTimeout(previous.timer)
    const payload = { user_id: user.id, year: plan.year, months: plan.months, premise: plan.premise, fiscal_params: plan.params }
    const timer = window.setTimeout(() => {
      // Sai do mapa ANTES da escrita: com o delete depois do await, uma entrada
      // de timer ja disparado seguiria visivel para o flush, que repetiria o
      // mesmo upsert enquanto o primeiro estivesse em voo.
      pending.current.delete(plan.year)
      void writePlan(payload)
    }, 450)
    pending.current.set(plan.year, { timer, payload })
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
    setError('')
    return true
  }, [plans, user])

  return { plans, loading, error, savePlan, deletePlan, reload: load }
}
