import { useCallback, useMemo } from 'react'
import { supabase, translateAuthError } from '../lib/supabase.js'
import { generateVerifier, deriveChallenge } from '../lib/pkce.js'
import { recoveryVerifier } from '../lib/recoveryCode.js'
import { rememberedAccounts } from '../lib/rememberedAccounts.js'
import { corpoVazioDoSdk } from '../lib/passkeyErrors.js'
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
    // Leitura do nivel falhou: nao conceder em silencio nem logar login_success.
    // A senha ja passou; devolvemos erro transitorio para o usuario tentar de novo,
    // sem tratar a falha como aal1 confirmado (criterio de aceite IMPR-010).
    if (assurance?.error) {
      return { error: 'Não foi possível confirmar o nível de segurança da sessão. Tente novamente.' }
    }
    if (assurance?.nextLevel === 'aal2' && assurance.nextLevel !== assurance.currentLevel) {
      return { data, mfaRequired: true }
    }
    await logAuthEvent(AUTH_EVENTS.LOGIN_SUCCESS, 'info', {})
    return { data }
  }, [refreshAssurance])

  // ---------- Passkey (IMPR-010 Fase 3) ----------

  // Limpa a marca local quando a conta zera as passkeys: a tela de login volta
  // ao normal (sem cracha). E-mail pela sessao, mesmo padrao de registerPasskey.
  // ponytail: a marca e um booleano por navegador; so some quando a conta zera
  // as passkeys. Nao da para saber barato qual credencial guardada e a deste
  // navegador; revogar uma de varias (em outro aparelho) nao limpa a marca daqui
  // - o fallback da tela de login (passkey falha -> revela senha) cobre isso.
  const unmarkLocalPasskey = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    const email = data?.user?.email
    if (email) rememberedAccounts.unmarkPasskey(email)
  }, [])

  const listPasskeys = useCallback(async () => {
    if (!supabase) return { error: 'Supabase não configurado.' }
    const { data, error } = await supabase.auth.passkey.list()
    if (error) return { error: translateAuthError(error) }
    return { data: data || [] }
  }, [])

  const registerPasskey = useCallback(async () => {
    if (!supabase) return { error: 'Supabase não configurado.' }
    const { data: sessionData } = await supabase.auth.getUser()
    const { error } = await supabase.auth.registerPasskey()
    if (error) return { error: translateAuthError(error) }
    // Dica local: a tela de login passa a oferecer passkey nesta conta e navegador.
    const email = sessionData?.user?.email
    if (email) rememberedAccounts.markPasskey(email)
    await logAuthEvent(AUTH_EVENTS.PASSKEY_REGISTERED, 'warning', {})
    return { ok: true }
  }, [])

  const signInWithPasskey = useCallback(async ({ captchaToken } = {}) => {
    if (!supabase) return { error: 'Supabase não configurado.' }
    const { data, error } = await supabase.auth.signInWithPasskey({
      options: captchaToken ? { captchaToken } : undefined,
    })
    if (error) return { error: translateAuthError(error), name: error.name }
    const assurance = await refreshAssurance()
    if (assurance?.error) {
      return { error: 'Não foi possível confirmar o nível de segurança da sessão. Tente novamente.' }
    }
    // Passkey entrega aal1; com TOTP cadastrado o gate nativo pede o desafio.
    if (assurance?.nextLevel === 'aal2' && assurance.nextLevel !== assurance.currentLevel) {
      return { data, mfaRequired: true }
    }
    await logAuthEvent(AUTH_EVENTS.LOGIN_SUCCESS, 'info', {})
    return { data }
  }, [refreshAssurance])

  const revokePasskey = useCallback(async (passkeyId) => {
    if (!supabase) return { error: 'Supabase não configurado.' }
    const id = String(passkeyId || '').trim()
    if (!id) return { error: 'Chave de acesso inválida.' }
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: id })
      if (error) throw error
    } catch (erro) {
      if (!corpoVazioDoSdk(erro)) return { error: translateAuthError(erro) }
    }
    // Corpo vazio ou nao, a verdade e a lista depois da operacao.
    const { data: lista } = await supabase.auth.passkey.list()
    const revogada = !(lista ?? []).some((p) => p.id === id)
    if (revogada) {
      await logAuthEvent(AUTH_EVENTS.PASSKEY_REVOKED, 'warning', {})
      if ((lista ?? []).length === 0) await unmarkLocalPasskey()
    }
    return revogada ? { ok: true } : { error: 'A chave de acesso não pôde ser revogada.' }
  }, [unmarkLocalPasskey])

  const revokeAllPasskeys = useCallback(async () => {
    if (!supabase) return { error: 'Supabase não configurado.' }
    const { data: lista, error } = await supabase.auth.passkey.list()
    if (error) return { error: translateAuthError(error) }
    for (const p of lista ?? []) {
      try {
        const { error: delError } = await supabase.auth.passkey.delete({ passkeyId: p.id })
        if (delError) throw delError
      } catch (erro) {
        if (!corpoVazioDoSdk(erro)) return { error: translateAuthError(erro) }
      }
    }
    const { data: restante } = await supabase.auth.passkey.list()
    if ((restante ?? []).length > 0) return { error: 'Nem todas as chaves puderam ser revogadas.' }
    await logAuthEvent(AUTH_EVENTS.PASSKEY_REVOKED_ALL, 'warning', {})
    await unmarkLocalPasskey()
    return { ok: true }
  }, [unmarkLocalPasskey])

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
    // Trocar a senha revoga todas as passkeys: a senha antiga pode ter vazado e a
    // passkey e um caminho de entrada que ela nao deve deixar para tras. Gerir
    // passkey exige aal2 quando ha MFA (medido na Fase 0: 403 insufficient_aal);
    // sem MFA, aal2 e inatingivel e a revogacao opera no aal1 mesmo. Por isso o
    // bloqueio so vale quando ha passkey a revogar E o MFA esta habilitado.
    const { data: passkeys } = await supabase.auth.passkey.list()
    if ((passkeys ?? []).length > 0) {
      // refreshAssurance (nao o getAAL cru) para nao confundir "sem MFA" com
      // "falha ao ler o nivel": no erro, aborta em vez de seguir como aal1. Mesmo
      // padrao do signIn. O servidor ja barra a revogacao em aal1 com 403
      // insufficient_aal (Fase 0) - isto e a camada de UX antes desse teto.
      const assurance = await refreshAssurance()
      if (assurance?.error) {
        return { error: 'Não foi possível confirmar o nível de segurança da sessão. Tente novamente.' }
      }
      const mfaHabilitado = assurance?.nextLevel === 'aal2'
      if (mfaHabilitado && assurance?.currentLevel !== 'aal2') {
        return { error: 'Confirme o código do seu aplicativo autenticador antes de trocar a senha, para que as chaves de acesso possam ser revogadas.' }
      }
      const revoke = await revokeAllPasskeys()
      if (revoke.error) return { error: `Não foi possível revogar as chaves de acesso: ${revoke.error} A senha não foi alterada.` }
    }
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
  }, [revokeAllPasskeys, refreshAssurance])

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
    // `uri` e o otpauth:// que o QR code codifica (TASK-006): serve ao
    // gerenciador de senhas guardar a semente sem ler o QR na propria tela.
    // Como o QR e o segredo, nunca vai para log.
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }
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
    registerPasskey,
    signInWithPasskey,
    listPasskeys,
    revokePasskey,
    revokeAllPasskeys,
  }), [signIn, resetPassword, updatePassword, exchangeRecoveryCode, listFactors, enrollMfa, verifyMfaEnrollment, verifyMfaChallenge, disableMfa, registerPasskey, signInWithPasskey, listPasskeys, revokePasskey, revokeAllPasskeys])
}
