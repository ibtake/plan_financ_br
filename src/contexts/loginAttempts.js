// =====================================================================
// Controle local de tentativas de login
// =====================================================================
//
// Complementa o rate limit do Supabase com resposta imediata na interface.
// Nao substitui a protecao do servidor e pertence somente ao fluxo de auth.
// =====================================================================

const ATTEMPTS_KEY = 'planejador:login_attempts'
const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

export function getLoginLock() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || '{}')
    if (!raw.lockedUntil) return { locked: false, attempts: raw.count || 0, remainingMs: 0 }
    const remaining = raw.lockedUntil - Date.now()
    if (remaining <= 0) {
      sessionStorage.removeItem(ATTEMPTS_KEY)
      return { locked: false, attempts: 0, remainingMs: 0 }
    }
    return { locked: true, attempts: raw.count || 0, remainingMs: remaining }
  } catch {
    return { locked: false, attempts: 0, remainingMs: 0 }
  }
}

export function registerFailedLogin() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || '{}')
    const count = (raw.count || 0) + 1
    const payload = { count }
    if (count >= MAX_ATTEMPTS) {
      payload.lockedUntil = Date.now() + LOCK_MINUTES * 60 * 1000
      payload.count = 0
    }
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(payload))
    return { locked: Boolean(payload.lockedUntil), attempts: count, max: MAX_ATTEMPTS }
  } catch {
    return { locked: false, attempts: 0, max: MAX_ATTEMPTS }
  }
}

export function clearLoginAttempts() {
  try {
    sessionStorage.removeItem(ATTEMPTS_KEY)
  } catch {
    /* noop */
  }
}
