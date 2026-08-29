import { useCallback, useMemo } from 'react'
import { supabase, translateAuthError } from '../lib/supabase.js'
import { AUTH_EVENTS, logAuthEvent } from './authAudit.js'
import {
  registerFailedLogin,
  clearLoginAttempts,
  getLoginLock,
} from './loginAttempts.js'

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
      await logAuthEvent(AUTH_EVENTS.LOGIN_FAILED, 'warning', { attempts: attempt.attempts })
      const restantes = attempt.max - attempt.attempts
      const aviso = !attempt.locked && restantes > 0 && restantes <= 2
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
    return { ok: true }
  }, [])

  const updatePassword = useCallback(async (newPassword) => {
    if (!supabase) return { error: 'Supabase nao configurado.' }
    const strength = validatePassword(newPassword)
    if (!strength.valid) return { error: 'A nova senha nao atende a politica de seguranca.' }
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

  const listFactors = useCallback(async () => {
    if (!supabase) return []
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) return []
    return (data?.totp || []).filter((f) => f.status === 'verified')
  }, [])

  const enrollMfa = useCallback(async () => {
    if (!supabase) return { error: 'Supabase nao configurado.' }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'DinDin 10!',
      friendlyName: `DinDin 10! ${new Date().toISOString()}`,
    })
    if (error) return { error: translateAuthError(error) }
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
  }, [])

  const verifyMfaEnrollment = useCallback(async (factorId, code) => {
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
    if (refreshError) return { error: 'MFA ativado, mas nao foi possivel atualizar a sessao. Faca login novamente.' }
    await refreshAssurance()
    return { ok: true }
  }, [refreshAssurance])

  const verifyMfaChallenge = useCallback(async (code) => {
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
  }, [listFactors, refreshAssurance])

  const disableMfa = useCallback(async (code) => {
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
