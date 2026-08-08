// Adaptador de auditoria do dominio de autenticacao.
// A implementacao compartilhada continua em lib/audit.js.

import { EVENTS, logEvent } from '../lib/audit.js'

export const AUTH_EVENTS = {
  LOGIN_SUCCESS: EVENTS.LOGIN_SUCCESS,
  LOGIN_FAILED: EVENTS.LOGIN_FAILED,
  LOGOUT: EVENTS.LOGOUT,
  MFA_ENROLLED: EVENTS.MFA_ENROLLED,
  MFA_REMOVED: EVENTS.MFA_REMOVED,
  MFA_OK: EVENTS.MFA_OK,
  MFA_FAILED: EVENTS.MFA_FAILED,
  PASSWORD_RESET: EVENTS.PASSWORD_RESET,
  PASSWORD_CHANGED: EVENTS.PASSWORD_CHANGED,
}

export function logAuthEvent(eventType, severity, details) {
  return logEvent(eventType, severity, details)
}
