import { useCallback, useMemo } from 'react'
import { supabase, translateAuthError } from '../lib/supabase.js'
import { generateVerifier, deriveChallenge } from '../lib/pkce.js'
import { recoveryVerifier } from '../lib/recoveryCode.js'
import { AUTH_EVENTS, logAuthEvent } from './authAudit.js'
import {
  registerFailedLogin,
  clearLoginAttempts,
  getLoginLock,
} from './loginAttempts.js'

// O reset de senha fala direto com o GoTrue em vez de usar o SDK (BUG-003):
// resetPasswordForEmail amarra o code_verifier ao storage de quem pediu, e o
// link do e-mail abre em outro navegador. Aqui o verifier vai no proprio link.
// A anon key e publica por natureza no bundle - mesmo padrao de widgetApi.js.
const AUTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const AUTH_HEADERS = { apikey: ANON_KEY, 'Content-Type': 'application/json' }

/** Normaliza o erro do GoTrue no formato que translateAuthError espera. */
function gotrueError(response, body) {
  return { message: body?.msg || body?.error_description || body?.error || `HTTP ${response.status}` }
}

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

export function useAuthOperations({ refreshAssurance }) {
  const signIn = useCallback(async ({ email, password, captchaToken }) => {
    if (!supabase) return { error: 'Supabase não configurado.' }
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
      await logAuthEvent(AUTH_EVENTS.LOGIN_FAILED, 'warning', { attempts: attempt.attempts })
      const restantes = attempt.max - attempt.attempts
      const aviso = !attempt.locked && restantes > 0 && restantes <= 2
        ? ` Restam ${restantes} tentativa(s) antes do bloqueio temporário.`
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
    if (!supabase) return { error: 'Supabase não configurado.' }
    const verifier = generateVerifier()
    const challenge = await deriveChallenge(verifier)
    // O verifier viaja no redirect_to. O GoTrue preserva a query string do
    // redirect_to (o proprio SDK depende disso para o seu sb_flow_id).
    const redirectTo = `${window.location.origin}/reset-password?v=${verifier}`
    try {
      const response = await fetch(
        `${AUTH_URL}/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
        {
          method: 'POST',
          headers: AUTH_HEADERS,
          body: JSON.stringify({
            email: String(email || '').trim().toLowerCase(),
            code_challenge: challenge,
            code_challenge_method: 's256',
            ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}),
          }),
        },
      )
      // O GoTrue responde 200 tambem para e-mail inexistente, de proposito:
      // confirmar a existencia da conta permitiria enumerar usuarios.
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        return { error: translateAuthError(gotrueError(response, body)) }
      }
    } catch (networkError) {
      return { error: translateAuthError(networkError) }
    }
    await logAuthEvent(AUTH_EVENTS.PASSWORD_RESET, 'warning', {})
    return { ok: true }
  }, [])

  const updatePassword = useCallback(async (newPassword) => {
    if (!supabase) return { error: 'Supabase não configurado.' }
    const strength = validatePassword(newPassword)
    if (!strength.valid) return { error: 'A nova senha não atende à política de segurança.' }
    let widgetWarning = null
    try {
      const { error: revokeError } = await supabase.functions.invoke('widget-setup', { body: { action: 'revoke' } })
      if (revokeError) widgetWarning = 'não foi possível revogar o widget'
    } catch {
      widgetWarning = 'não foi possível revogar o widget'
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
    if (!supabase) return { error: 'Supabase não configurado.' }
    const normalizedCode = String(code || '').trim()
    if (!normalizedCode) return { error: 'Link de recuperação inválido ou expirado.' }
    const invalido = 'Link de recuperação inválido ou expirado.'
    // Caminho novo: o verifier veio no link, entao a troca nao depende do
    // storage do navegador onde o reset nasceu.
    if (recoveryVerifier) {
      try {
        const response = await fetch(`${AUTH_URL}/token?grant_type=pkce`, {
          method: 'POST',
          headers: AUTH_HEADERS,
          body: JSON.stringify({ auth_code: normalizedCode, code_verifier: recoveryVerifier }),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok || !body?.access_token) {
          return { error: translateAuthError(gotrueError(response, body)) || invalido }
        }
        const { data, error } = await supabase.auth.setSession({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
        })
        if (error || !data?.session) return { error: translateAuthError(error) || invalido }
        return { data }
      } catch (networkError) {
        return { error: translateAuthError(networkError) || invalido }
      }
    }
    // Fallback: link sem ?v= (e-mail antigo ainda em transito).
    const { data, error } = await supabase.auth.exchangeCodeForSession(normalizedCode)
    if (error || !data?.session) return { error: translateAuthError(error) || invalido }
    return { data }
  }, [])

  const listFactors = useCallback(async () => {
    if (!supabase) return []
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) return []
    return (data?.totp || []).filter((f) => f.status === 'verified')
  }, [])

  const enrollMfa = useCallback(async () => {
    if (!supabase) return { error: 'Supabase não configurado.' }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'DinDin 10!',
      friendlyName: `DinDin 10! ${new Date().toISOString()}`,
    })
    if (error) return { error: translateAuthError(error) }
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
  }, [])

  const verifyMfaEnrollment = useCallback(async (factorId, code) => {
    if (!supabase) return { error: 'Supabase não configurado.' }
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
    if (refreshError) return { error: 'MFA ativado, mas não foi possível atualizar a sessão. Faça login novamente.' }
    await refreshAssurance()
    return { ok: true }
  }, [refreshAssurance])

  const verifyMfaChallenge = useCallback(async (code) => {
    if (!supabase) return { error: 'Supabase não configurado.' }
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
  }, [listFactors, refreshAssurance])

  const disableMfa = useCallback(async (code) => {
    if (!supabase) return { error: 'Supabase não configurado.' }
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
  }, [listFactors, refreshAssurance])

  return useMemo(() => ({
    signIn,
    resetPassword,
    updatePassword,
    exchangeRecoveryCode,
    listFactors,
    enrollMfa,
    verifyMfaEnrollment,
    verifyMfaChallenge,
    disableMfa,
  }), [signIn, resetPassword, updatePassword, exchangeRecoveryCode, listFactors, enrollMfa, verifyMfaEnrollment, verifyMfaChallenge, disableMfa])
}
