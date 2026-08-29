import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { offlineDb, OFFLINE_CACHE_PREFERENCE_KEY } from '../lib/offlineDb.js'
import { createRefreshCoordinator, isRetryableConnectionError, retryDelay } from '../lib/offlineRevalidation.js'
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
  const [sessionRevision, setSessionRevision] = useState(0)
  const [offlineCacheEnabled, setOfflineCacheEnabled] = useState(false)
  const idleTimer = useRef(null)
  const lastActivityAt = useRef(0)
  const currentUserId = useRef(null)
  const refreshRequest = useRef(async () => false)
  const retryTimer = useRef(null)
  const retryAttempt = useRef(0)
  const scheduleRetryRef = useRef(null)

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
    if (currentUserId.current) await offlineDb.purgeUser(currentUserId.current)
    if (retryTimer.current) window.clearTimeout(retryTimer.current)
    retryTimer.current = null
    retryAttempt.current = 0
    await supabase.auth.signOut()
    clearUserActivity()
    lastActivityAt.current = 0
    setSession(null)
    setUser(null)
    currentUserId.current = null
    setMfaStage('none')
    setOfflineCacheEnabled(false)
  }, [])

  const requestSessionRefresh = useCallback(() => refreshRequest.current(), [])

  const clearSessionRetry = useCallback(() => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current)
    retryTimer.current = null
    retryAttempt.current = 0
  }, [])

  const scheduleSessionRetry = useCallback(() => {
    if (retryTimer.current || document.visibilityState !== 'visible') return
    const delay = retryDelay(retryAttempt.current++)
    retryTimer.current = window.setTimeout(async () => {
      retryTimer.current = null
      const refreshed = await requestSessionRefresh()
      if (!refreshed) scheduleRetryRef.current?.()
    }, delay)
  }, [requestSessionRefresh])
  useEffect(() => {
    scheduleRetryRef.current = scheduleSessionRetry
  }, [scheduleSessionRetry])

  const signOutIdle = useCallback(async () => {
    let error = null
    try {
      ({ error } = await supabase.auth.signOut())
    } catch (caught) {
      error = caught
    }
    if (!error) return
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session) scheduleSessionRetry()
    } catch {
      // Sem sessão confirmada, aguardar o próximo ciclo de visibilidade.
    }
  }, [scheduleSessionRetry])

  const setOfflineCache = useCallback(async (enabled) => {
    const userId = currentUserId.current
    if (!userId) return false
    const saved = await offlineDb.setEnabled(userId, enabled)
    if (saved) setOfflineCacheEnabled(Boolean(enabled))
    return saved
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
        await signOutIdle()
        nextSession = null
      }
      if (nextSession) await refreshAssurance()
      else {
        setMfaStage('none')
        setAssuranceLevel(null)
      }
      if (!active || version !== sessionVersion) return
      const previousUserId = currentUserId.current
      const nextUserId = nextSession?.user?.id || null
      if (previousUserId && previousUserId !== nextUserId) await offlineDb.purgeUser(previousUserId)
      currentUserId.current = nextUserId
      setSession(nextSession || null)
      setUser((current) => (
        current?.id === nextSession?.user?.id && current?.updated_at === nextSession?.user?.updated_at
          ? current
          : nextSession?.user || null
      ))
      setOfflineCacheEnabled(nextUserId ? offlineDb.preferenceEnabled(nextUserId) : false)
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
      const { data: current } = await supabase.auth.getSession()
      if (!current.session) {
        const version = ++sessionVersion
        await applySession(null, version)
        return false
      }
      if (isIdleSession(current.session)) {
        clearUserActivity()
        await signOutIdle()
        const version = ++sessionVersion
        await applySession(null, version)
        return false
      }
      const expiresAt = Number(current.session.expires_at || 0) * 1000
      if (!expiresAt || expiresAt - Date.now() <= SESSION_REFRESH_SKEW_MS) {
        const { data, error } = await supabase.auth.refreshSession()
        if (error || !data.session) {
          if (isRetryableConnectionError(error)) {
            scheduleSessionRetry()
            return false
          }
          const version = ++sessionVersion
          await applySession(null, version)
          return false
        }
      }
      setSessionRevision((value) => value + 1)
      return true
    }

    const coordinatedRefresh = createRefreshCoordinator(async () => {
      try {
        return await refreshSessionOnReturn()
      } catch (error) {
        if (isRetryableConnectionError(error)) scheduleSessionRetry()
        return false
      }
    })
    refreshRequest.current = coordinatedRefresh

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        if (retryTimer.current) window.clearTimeout(retryTimer.current)
        retryTimer.current = null
        return
      }
      void coordinatedRefresh()
    }
    const handleReturn = () => { void coordinatedRefresh() }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handleReturn)
    window.addEventListener('focus', handleReturn)
    window.addEventListener('online', handleReturn)

    return () => {
      active = false
      refreshRequest.current = async () => false
      if (retryTimer.current) window.clearTimeout(retryTimer.current)
      retryTimer.current = null
      listener?.subscription?.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handleReturn)
      window.removeEventListener('focus', handleReturn)
      window.removeEventListener('online', handleReturn)
    }
  }, [isIdleSession, markUserActivity, refreshAssurance, scheduleSessionRetry, signOutIdle])

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
      if (event.key === OFFLINE_CACHE_PREFERENCE_KEY) {
        setOfflineCacheEnabled(offlineDb.preferenceEnabled(session.user.id))
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

  return {
    session, user, loading, mfaStage, assuranceLevel, sessionRevision,
    offlineCacheEnabled, refreshAssurance, requestSessionRefresh,
    scheduleSessionRetry, clearSessionRetry, setOfflineCache, signOut,
  }
}
