import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { AUTH_EVENTS, logAuthEvent } from './authAudit.js'

const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const LAST_ACTIVITY_KEY = 'planejador:last-activity-at'
const SESSION_REFRESH_SKEW_MS = 60 * 1000
const ACTIVITY_THROTTLE_MS = 1000

function getStoredLastActivityAt() {
  try {
    const stored = Number(window.localStorage.getItem(LAST_ACTIVITY_KEY))
    if (Number.isFinite(stored) && stored > 0) return stored
  } catch {
    // O armazenamento local e apenas complementar ao controle em memoria.
  }
  return 0
}

function getSessionStartedAt(session) {
  const signedInAt = Date.parse(session?.user?.last_sign_in_at || '')
  return Number.isFinite(signedInAt) ? signedInAt : 0
}

function clearUserActivity() {
  try {
    window.localStorage.removeItem(LAST_ACTIVITY_KEY)
  } catch {
    // Nada a limpar quando storage nao esta disponivel.
  }
}

export function useAuthSession() {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mfaStage, setMfaStage] = useState('none')
  const [assuranceLevel, setAssuranceLevel] = useState(null)
  const idleTimer = useRef(null)
  const lastActivityAt = useRef(0)
  const refreshInFlight = useRef(null)

  const getLastActivityAt = useCallback((currentSession) => (
    Math.max(lastActivityAt.current, getStoredLastActivityAt(), getSessionStartedAt(currentSession))
  ), [])

  const markUserActivity = useCallback(() => {
    const now = Date.now()
    lastActivityAt.current = now
    try {
      window.localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
    } catch {
      // Outra aba pode nao receber a atividade, mas esta aba continua protegida.
    }
  }, [])

  const isIdleSession = useCallback((currentSession) => (
    Date.now() - getLastActivityAt(currentSession) >= IDLE_TIMEOUT_MS
  ), [getLastActivityAt])

  const refreshAssurance = useCallback(async () => {
    if (!supabase) return null
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      setAssuranceLevel(data || null)
      if (data?.nextLevel === 'aal2' && data.nextLevel !== data.currentLevel) {
        setMfaStage('required')
      } else {
        setMfaStage(data?.currentLevel === 'aal2' ? 'verified' : 'none')
      }
      return data
    } catch {
      return null
    }
  }, [])

  const signOut = useCallback(async (reason = 'manual') => {
    if (!supabase) return
    if (reason === 'manual') await logAuthEvent(AUTH_EVENTS.LOGOUT, 'info', { reason })
    await supabase.auth.signOut()
    clearUserActivity()
    lastActivityAt.current = 0
    setSession(null)
    setUser(null)
    setMfaStage('none')
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true
    let authEventReceived = false
    let sessionVersion = 0

    const applySession = async (nextSession, version) => {
      if (!active || version !== sessionVersion) return
      if (nextSession && isIdleSession(nextSession)) {
        clearUserActivity()
        await supabase.auth.signOut()
        nextSession = null
      }
      if (nextSession) await refreshAssurance()
      else {
        setMfaStage('none')
        setAssuranceLevel(null)
      }
      if (!active || version !== sessionVersion) return
      setSession(nextSession || null)
      setUser((current) => (
        current?.id === nextSession?.user?.id && current?.updated_at === nextSession?.user?.updated_at
          ? current
          : nextSession?.user || null
      ))
      setLoading(false)
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      authEventReceived = true
      const version = ++sessionVersion
      if (event === 'SIGNED_IN') markUserActivity()
      void applySession(newSession, version)
    })

    supabase.auth.getSession().then(({ data }) => {
      if (authEventReceived) return
      const version = ++sessionVersion
      void applySession(data.session, version)
    })

    const refreshSessionOnReturn = async () => {
      if (!active || document.visibilityState !== 'visible') return
      if (refreshInFlight.current) return refreshInFlight.current

      refreshInFlight.current = (async () => {
        const { data: current } = await supabase.auth.getSession()
        if (!current.session) {
          const version = ++sessionVersion
          await applySession(null, version)
          return
        }
        if (isIdleSession(current.session)) {
          clearUserActivity()
          await supabase.auth.signOut()
          const version = ++sessionVersion
          await applySession(null, version)
          return
        }
        const expiresAt = Number(current.session.expires_at || 0) * 1000
        if (expiresAt && expiresAt - Date.now() > SESSION_REFRESH_SKEW_MS) return
        const { data, error } = await supabase.auth.refreshSession()
        if (error || !data.session) {
          const version = ++sessionVersion
          await applySession(null, version)
        }
      })()

      try {
        await refreshInFlight.current
      } finally {
        refreshInFlight.current = null
      }
    }

    const handleVisibilityChange = () => { void refreshSessionOnReturn() }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)

    return () => {
      active = false
      listener?.subscription?.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
    }
  }, [isIdleSession, markUserActivity, refreshAssurance])

  useEffect(() => {
    if (!session) return

    const schedule = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      const elapsed = Date.now() - getLastActivityAt(session)
      const remaining = Math.max(0, IDLE_TIMEOUT_MS - elapsed)
      idleTimer.current = setTimeout(() => {
        if (isIdleSession(session)) void signOut('idle_timeout')
        else schedule()
      }, remaining)
    }

    let lastReset = 0
    const reset = () => {
      const now = Date.now()
      if (now - lastReset < ACTIVITY_THROTTLE_MS) return
      lastReset = now
      markUserActivity()
      schedule()
    }

    if (isIdleSession(session)) {
      signOut('idle_timeout')
      return
    }

    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    const handleSharedActivity = (event) => {
      if (event.key === LAST_ACTIVITY_KEY && event.newValue) {
        const updatedAt = Number(event.newValue)
        if (Number.isFinite(updatedAt) && updatedAt > 0) {
          lastActivityAt.current = Math.max(lastActivityAt.current, updatedAt)
        }
        schedule()
      }
    }
    window.addEventListener('storage', handleSharedActivity)
    schedule()

    return () => {
      events.forEach((e) => window.removeEventListener(e, reset))
      window.removeEventListener('storage', handleSharedActivity)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [getLastActivityAt, isIdleSession, markUserActivity, session, signOut])

  return { session, user, loading, mfaStage, assuranceLevel, refreshAssurance, signOut }
}
