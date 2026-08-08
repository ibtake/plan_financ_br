// =====================================================================
// AuthContext - sessao, login e MFA (TOTP)
// =====================================================================
//
// Concentra toda a interacao com o Supabase Auth. Os componentes de
// interface nunca falam diretamente com a API de autenticacao.
//
// NOTAS DE SEGURANCA
//   - O segredo TOTP nunca e persistido pela aplicacao; ele existe
//     apenas na memoria durante a ativacao e depois fica sob guarda do
//     Supabase.
//   - Erros de login usam mensagem generica para nao revelar quais
//     e-mails existem na base (evita enumeracao de usuarios).
//   - Ha logout automatico por inatividade.
// =====================================================================

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured, translateAuthError } from '../lib/supabase.js'
import {
  EVENTS,
  logEvent,
  registerFailedLogin,
  clearLoginAttempts,
  getLoginLock,
} from '../lib/audit.js'

const AuthContext = createContext(null)

/** Encerra a sessao apos este periodo sem interacao */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const LAST_ACTIVITY_KEY = 'planejador:last-activity-at'

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

/** Senha considerada aceitavel pela politica da aplicacao */
export function validatePassword(password) {
  const value = String(password || '')
  const checks = {
    length: value.length >= 10,
    lower: /[a-z]/.test(value),
    upper: /[A-Z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  }
  const score = Object.values(checks).filter(Boolean).length
  const variety = [checks.lower, checks.upper, checks.number, checks.symbol].filter(Boolean).length
  return { checks, score, valid: checks.length && variety >= 3 }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // 'none' = sem MFA | 'required' = precisa do codigo | 'verified' = liberado
  const [mfaStage, setMfaStage] = useState('none')
  const [assuranceLevel, setAssuranceLevel] = useState(null)
  const idleTimer = useRef(null)
  const lastActivityAt = useRef(0)

  const getLastActivityAt = useCallback((currentSession) => (
    Math.max(
      lastActivityAt.current,
      getStoredLastActivityAt(),
      getSessionStartedAt(currentSession),
    )
  ), [])

  const markUserActivity = useCallback(() => {
    const now = Date.now()
    // Esta referencia e a fonte confiavel durante a sessao atual. Assim,
    // interacoes continuam adiando o logout mesmo com localStorage bloqueado.
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

  // ---------- Sessao ----------

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

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true

    const applySession = async (nextSession) => {
      if (!active) return
      if (nextSession && isIdleSession(nextSession)) {
        clearUserActivity()
        await supabase.auth.signOut()
        nextSession = null
      }
      setSession(nextSession || null)
      setUser(nextSession?.user || null)
      if (nextSession) await refreshAssurance()
      else {
        setMfaStage('none')
        setAssuranceLevel(null)
      }
      if (active) setLoading(false)
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session))

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_IN') markUserActivity()
      void applySession(newSession)
    })

    // O Safari em modo app pode congelar a renovação automática do token em
    // segundo plano. Ao retornar, a sessão é validada antes de reutilizar a
    // Dashboard; uma sessão inválida volta para a tela de login.
    const refreshSessionOnReturn = async () => {
      if (!active || document.visibilityState !== 'visible') return
      const { data: current } = await supabase.auth.getSession()
      if (!current.session) {
        await applySession(null)
        return
      }
      if (isIdleSession(current.session)) {
        clearUserActivity()
        await supabase.auth.signOut()
        await applySession(null)
        return
      }
      const { data, error } = await supabase.auth.refreshSession()
      if (error || !data.session) {
        await applySession(null)
        return
      }
      await applySession(data.session)
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

  // ---------- Logout por inatividade ----------

  const signOut = useCallback(
    async (reason = 'manual') => {
      if (!supabase) return
      if (reason === 'manual') await logEvent(EVENTS.LOGOUT, 'info', { reason })
      await supabase.auth.signOut()
      clearUserActivity()
      lastActivityAt.current = 0
      setSession(null)
      setUser(null)
      setMfaStage('none')
    },
    [],
  )

  useEffect(() => {
    if (!session) return

    const clearTimer = () => {
      markUserActivity()
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }

    const schedule = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      const elapsed = Date.now() - getLastActivityAt(session)
      const remaining = Math.max(0, IDLE_TIMEOUT_MS - elapsed)
      idleTimer.current = setTimeout(() => {
        // O prazo e compartilhado entre abas: uma aba sem uso nao pode
        // encerrar uma sessao que continua ativa em outra.
        if (isIdleSession(session)) {
          void signOut('idle_timeout')
        } else {
          schedule()
        }
      }, remaining)
    }

    const reset = () => {
      clearTimer()
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
  }, [isIdleSession, markUserActivity, session, signOut])

  // ---------- Login ----------

  const signIn = useCallback(async ({ email, password, captchaToken }) => {
    if (!supabase) return { error: 'Supabase nao configurado.' }

    const lock = getLoginLock()
    if (lock.locked) {
      const minutes = Math.ceil(lock.remainingMs / 60000)
      return { error: `Muitas tentativas falhas. Tente novamente em ${minutes} minuto(s).` }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })

    if (error) {
      const attempt = registerFailedLogin()
      // O evento so e gravado se houver sessao; sem sessao, o proprio
      // rate limit do Supabase e a defesa ativa.
      await logEvent(EVENTS.LOGIN_FAILED, 'warning', { attempts: attempt.attempts })
      const restantes = attempt.max - attempt.attempts
      const aviso =
        !attempt.locked && restantes > 0 && restantes <= 2
          ? ` Restam ${restantes} tentativa(s) antes do bloqueio temporario.`
          : ''
      return { error: translateAuthError(error) + aviso }
    }

    clearLoginAttempts()
    const assurance = await refreshAssurance()

    if (assurance?.nextLevel === 'aal2' && assurance.nextLevel !== assurance.currentLevel) {
      return { data, mfaRequired: true }
    }

    await logEvent(EVENTS.LOGIN_SUCCESS, 'info', {})
    return { data }
  }, [refreshAssurance])

  const resetPassword = useCallback(async (email, captchaToken) => {
    if (!supabase) return { error: 'Supabase nao configurado.' }
    const { error } = await supabase.auth.resetPasswordForEmail(
      String(email || '').trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/`, ...(captchaToken ? { captchaToken } : {}) },
    )
    if (error) return { error: translateAuthError(error) }
    await logEvent(EVENTS.PASSWORD_RESET, 'warning', {})
    // Resposta identica mesmo se o e-mail nao existir (anti-enumeracao)
    return { ok: true }
  }, [])

  const updatePassword = useCallback(async (newPassword) => {
    if (!supabase) return { error: 'Supabase nao configurado.' }
    const strength = validatePassword(newPassword)
    if (!strength.valid) return { error: 'A nova senha nao atende a politica de seguranca.' }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { error: translateAuthError(error) }
    await logEvent(EVENTS.PASSWORD_CHANGED, 'warning', {})
    return { ok: true }
  }, [])

  // ---------- MFA / TOTP ----------

  /** Lista os fatores TOTP ja confirmados */
  const listFactors = useCallback(async () => {
    if (!supabase) return []
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) return []
    return (data?.totp || []).filter((f) => f.status === 'verified')
  }, [])

  /** Inicia a ativacao: retorna QR code e segredo para o app autenticador */
  const enrollMfa = useCallback(async () => {
    if (!supabase) return { error: 'Supabase nao configurado.' }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'DinDin 10!',
      friendlyName: `DinDin 10! ${new Date().toISOString().slice(0, 10)}`,
    })
    if (error) return { error: translateAuthError(error) }
    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    }
  }, [])

  /** Confirma a ativacao validando o primeiro codigo gerado */
  const verifyMfaEnrollment = useCallback(
    async (factorId, code) => {
      if (!supabase) return { error: 'Supabase nao configurado.' }
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: String(code || '').replace(/\D/g, ''),
      })
      if (error) {
        await logEvent(EVENTS.MFA_FAILED, 'warning', { context: 'enrollment' })
        return { error: translateAuthError(error) }
      }
      await logEvent(EVENTS.MFA_ENROLLED, 'warning', {})
      await refreshAssurance()
      return { ok: true }
    },
    [refreshAssurance],
  )

  /** Valida o codigo durante o login */
  const verifyMfaChallenge = useCallback(
    async (code) => {
      if (!supabase) return { error: 'Supabase nao configurado.' }
      const factors = await listFactors()
      if (!factors.length) return { error: 'Nenhum aplicativo autenticador configurado.' }

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factors[0].id,
        code: String(code || '').replace(/\D/g, ''),
      })

      if (error) {
        await logEvent(EVENTS.MFA_FAILED, 'critical', { context: 'login' })
        return { error: translateAuthError(error) }
      }

      await logEvent(EVENTS.MFA_OK, 'info', {})
      await logEvent(EVENTS.LOGIN_SUCCESS, 'info', { mfa: true })
      await refreshAssurance()
      return { ok: true }
    },
    [listFactors, refreshAssurance],
  )

  /** Remove o fator TOTP, exigindo um codigo valido antes */
  const disableMfa = useCallback(
    async (code) => {
      if (!supabase) return { error: 'Supabase nao configurado.' }
      const factors = await listFactors()
      if (!factors.length) return { error: 'Nenhum fator ativo.' }

      const verify = await supabase.auth.mfa.challengeAndVerify({
        factorId: factors[0].id,
        code: String(code || '').replace(/\D/g, ''),
      })
      if (verify.error) {
        await logEvent(EVENTS.MFA_FAILED, 'critical', { context: 'disable' })
        return { error: translateAuthError(verify.error) }
      }

      const { error } = await supabase.auth.mfa.unenroll({ factorId: factors[0].id })
      if (error) return { error: translateAuthError(error) }

      await logEvent(EVENTS.MFA_REMOVED, 'critical', {})
      await refreshAssurance()
      return { ok: true }
    },
    [listFactors, refreshAssurance],
  )

  const value = {
    session,
    user,
    loading,
    mfaStage,
    assuranceLevel,
    isConfigured: isSupabaseConfigured,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    listFactors,
    enrollMfa,
    verifyMfaEnrollment,
    verifyMfaChallenge,
    disableMfa,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return ctx
}
