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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured, configurationProblem, translateAuthError } from '../lib/supabase.js'
import { AUTH_EVENTS, logAuthEvent } from './authAudit.js'
import {
  registerFailedLogin,
  clearLoginAttempts,
  getLoginLock,
} from './loginAttempts.js'

const AuthContext = createContext(null)

/** Encerra a sessao apos este periodo sem interacao */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const LAST_ACTIVITY_KEY = 'planejador:last-activity-at'
const SESSION_REFRESH_SKEW_MS = 60 * 1000
/** Janela minima entre dois resets do timer de inatividade (ver `reset`) */
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
  const missingConfig = configurationProblem()
  const idleTimer = useRef(null)
  const lastActivityAt = useRef(0)
  const refreshInFlight = useRef(null)

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
      // A referencia de `user` so troca quando a conta realmente muda. O GoTrue
      // entrega um objeto novo a cada TOKEN_REFRESHED, e trocar a referencia
      // recria o `load` de useSupabaseFinance e usePGBL: onze consultas e a UI de
      // volta ao esqueleto, apagando o lancamento em preenchimento. `updated_at`
      // no comparador mantem alteracoes reais da conta chegando (metadata, e-mail).
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

    // O Safari em modo app pode congelar a renovação automática do token em
    // segundo plano. Ao retornar, a sessão é validada antes de reutilizar a
    // Dashboard; uma sessão inválida volta para a tela de login.
    const refreshSessionOnReturn = async () => {
      if (!active || document.visibilityState !== 'visible') return
      // Em celulares, focus, pageshow e visibilitychange podem acontecer juntos.
      // Compartilhar a mesma promessa impede rotacoes concorrentes do refresh token.
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
          // Versao capturada depois do signOut: o evento SIGNED_OUT que ele emite
          // incrementa sessionVersion, e uma versao capturada antes cairia no
          // guard de applySession sem limpar nada.
          const version = ++sessionVersion
          await applySession(null, version)
          return
        }

        // Nao rotaciona um token ainda saudavel ao simples toque/foco na tela.
        // O cliente Supabase continua renovando automaticamente em segundo plano.
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

  // ---------- Logout por inatividade ----------

  const signOut = useCallback(
    async (reason = 'manual') => {
      if (!supabase) return
      if (reason === 'manual') await logAuthEvent(AUTH_EVENTS.LOGOUT, 'info', { reason })
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

    // Throttle: `scroll` dispara a cada quadro no mobile, e cada evento custava um
    // setItem + um getItem sincronos (getLastActivityAt), duas operacoes de timer e,
    // com outra aba aberta, o mesmo trabalho la via evento `storage`. `passive` nao
    // protege - o handler roda na main thread de todo jeito. Adiar o reset por <=1s e
    // seguro porque o callback do timer acima reagenda quando a sessao nao esta
    // ociosa: o prazo se corrige sozinho e o pior caso e encerrar em 4min59s.
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
      await logAuthEvent(AUTH_EVENTS.LOGIN_FAILED, 'warning', { attempts: attempt.attempts })
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

    await logAuthEvent(AUTH_EVENTS.LOGIN_SUCCESS, 'info', {})
    return { data }
  }, [refreshAssurance])

  const resetPassword = useCallback(async (email, captchaToken) => {
    if (!supabase) return { error: 'Supabase nao configurado.' }
    const { error } = await supabase.auth.resetPasswordForEmail(
      String(email || '').trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/reset-password`, ...(captchaToken ? { captchaToken } : {}) },
    )
    if (error) return { error: translateAuthError(error) }
    await logAuthEvent(AUTH_EVENTS.PASSWORD_RESET, 'warning', {})
    // Resposta identica mesmo se o e-mail nao existir (anti-enumeracao)
    return { ok: true }
  }, [])

  const updatePassword = useCallback(async (newPassword) => {
    if (!supabase) return { error: 'Supabase nao configurado.' }
    const strength = validatePassword(newPassword)
    if (!strength.valid) return { error: 'A nova senha nao atende a politica de seguranca.' }
    // Troca de senha e sinal de possivel comprometimento: o widget e uma
    // sessao persistente e morre aqui. A revogacao vem ANTES da troca -
    // depois dela o updated_at invalida o proprio token e o revoke falharia.
    // Falha do revoke nao bloqueia a troca (seguranca da conta primeiro);
    // retorna aviso para o usuario revogar manualmente nas configuracoes.
    let widgetWarning = null
    try {
      const { error: revokeError } = await supabase.functions.invoke('widget-setup', { body: { action: 'revoke' } })
      if (revokeError) widgetWarning = 'nao foi possivel revogar o widget'
    } catch {
      widgetWarning = 'nao foi possivel revogar o widget'
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { error: translateAuthError(error), code: error.code || null }
    await logAuthEvent(AUTH_EVENTS.PASSWORD_CHANGED, 'warning', {})
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' })
    if (signOutError) return { error: translateAuthError(signOutError) }
    return widgetWarning
      ? { ok: true, warning: `Senha alterada, mas ${widgetWarning}. Revogue o widget nas configurações e reinstale.` }
      : { ok: true }
  }, [])

  const exchangeRecoveryCode = useCallback(async (code) => {
    if (!supabase) return { error: 'Supabase nao configurado.' }
    const normalizedCode = String(code || '').trim()
    if (!normalizedCode) return { error: 'Link de recuperacao invalido ou expirado.' }
    const { data, error } = await supabase.auth.exchangeCodeForSession(normalizedCode)
    if (error || !data?.session) return { error: translateAuthError(error) || 'Link de recuperacao invalido ou expirado.' }
    return { data }
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
      friendlyName: `DinDin 10! ${new Date().toISOString()}`,
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
        await logAuthEvent(AUTH_EVENTS.MFA_FAILED, 'warning', { context: 'enrollment' })
        return { error: translateAuthError(error) }
      }
      await logAuthEvent(AUTH_EVENTS.MFA_ENROLLED, 'warning', {})
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) {
        return { error: 'MFA ativado, mas nao foi possivel atualizar a sessao. Faca login novamente.' }
      }
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
        await logAuthEvent(AUTH_EVENTS.MFA_FAILED, 'critical', { context: 'login' })
        return { error: translateAuthError(error) }
      }

      await logAuthEvent(AUTH_EVENTS.MFA_OK, 'info', {})
      await logAuthEvent(AUTH_EVENTS.LOGIN_SUCCESS, 'info', { mfa: true })
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
        await logAuthEvent(AUTH_EVENTS.MFA_FAILED, 'critical', { context: 'disable' })
        return { error: translateAuthError(verify.error) }
      }

      const { error } = await supabase.auth.mfa.unenroll({ factorId: factors[0].id })
      if (error) return { error: translateAuthError(error) }

      await logAuthEvent(AUTH_EVENTS.MFA_REMOVED, 'critical', {})
      await supabase.auth.refreshSession()
      await refreshAssurance()
      return { ok: true }
    },
    [listFactors, refreshAssurance],
  )

  const value = useMemo(() => ({
    session,
    user,
    loading,
    mfaStage,
    assuranceLevel,
    isConfigured: isSupabaseConfigured,
    configurationProblem: missingConfig,
    signIn,
    signOut,
    resetPassword,
    exchangeRecoveryCode,
    updatePassword,
    listFactors,
    enrollMfa,
    verifyMfaEnrollment,
    verifyMfaChallenge,
    disableMfa,
  }), [session, user, loading, mfaStage, assuranceLevel, missingConfig, signIn, signOut, resetPassword, exchangeRecoveryCode, updatePassword, listFactors, enrollMfa, verifyMfaEnrollment, verifyMfaChallenge, disableMfa])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return ctx
}
