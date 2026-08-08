// =====================================================================
// Camada compartilhada de seguranca e auditoria
// =====================================================================
//
// Registra eventos relevantes na tabela security_events do Supabase e
// protege operacoes de qualquer dominio contra tentativas de violacao de RLS.
//
// PRINCIPIOS APLICADOS
//   1. Nunca registrar segredo: senha, codigo TOTP ou chave do
//      autenticador jamais entram no log. Guardar isso criaria uma nova
//      vulnerabilidade em vez de reduzir risco.
//   2. Falha silenciosa: um erro ao gravar log nunca deve interromper a
//      acao do usuario.
//   3. Deteccao de RLS: quando o Postgres recusa uma operacao por
//      violacao de politica, isso e registrado como tentativa de acesso
//      indevido - o sinal de ataque mais importante do sistema.
// =====================================================================

import { supabase } from './supabase.js'

/** Tipos aceitos pela constraint da tabela security_events */
export const EVENTS = {
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILED: 'login_failed',
  LOGOUT: 'logout',
  SIGNUP: 'signup',
  MFA_ENROLLED: 'mfa_enrolled',
  MFA_REMOVED: 'mfa_removed',
  MFA_OK: 'mfa_challenge_success',
  MFA_FAILED: 'mfa_challenge_failed',
  PASSWORD_RESET: 'password_reset_requested',
  PASSWORD_CHANGED: 'password_changed',
  BULK_DELETE: 'bulk_delete',
  DATA_IMPORTED: 'data_imported',
  RLS_VIOLATION: 'rls_violation_attempt',
  SUSPICIOUS: 'suspicious_activity',
}

/** Descricoes legiveis para a interface */
export const EVENT_LABELS = {
  login_success: { icon: '✅', text: 'Login realizado' },
  login_failed: { icon: '⛔', text: 'Tentativa de login falhou' },
  logout: { icon: '👋', text: 'Sessão encerrada' },
  signup: { icon: '🆕', text: 'Conta criada' },
  mfa_enrolled: { icon: '🔐', text: 'Verificação em duas etapas ativada' },
  mfa_removed: { icon: '🔓', text: 'Verificação em duas etapas desativada' },
  mfa_challenge_success: { icon: '🔑', text: 'Código de verificação aceito' },
  mfa_challenge_failed: { icon: '🚨', text: 'Código de verificação incorreto' },
  password_reset_requested: { icon: '📧', text: 'Recuperação de senha solicitada' },
  password_changed: { icon: '🔁', text: 'Senha alterada' },
  bulk_delete: { icon: '🗑️', text: 'Exclusão em massa de dados' },
  data_imported: { icon: '📥', text: 'Dados importados' },
  rls_violation_attempt: { icon: '🛑', text: 'Tentativa de acesso a dados de outro usuário' },
  suspicious_activity: { icon: '⚠️', text: 'Atividade suspeita' },
}

/** Campos que nunca devem ser gravados, mesmo por engano */
const FORBIDDEN_KEYS = [
  'password',
  'senha',
  'token',
  'secret',
  'totp',
  'code',
  'codigo',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
]

/**
 * Remove qualquer campo sensivel do objeto de detalhes.
 * Rede de seguranca contra vazamento acidental no log.
 */
function sanitize(details) {
  if (!details || typeof details !== 'object') return {}
  const safe = {}
  for (const [key, value] of Object.entries(details)) {
    const lower = key.toLowerCase()
    if (FORBIDDEN_KEYS.some((f) => lower.includes(f))) continue
    if (typeof value === 'string') safe[key] = value.slice(0, 200)
    else if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value
    // objetos aninhados sao descartados: mantem o log simples e auditavel
  }
  return safe
}

/** User agent truncado, usado para identificar o dispositivo */
function userAgent() {
  try {
    return String(navigator.userAgent || '').slice(0, 400)
  } catch {
    return ''
  }
}

/**
 * Grava um evento de seguranca.
 * Requer sessao ativa: a funcao no banco ignora chamadas anonimas.
 */
export async function logEvent(eventType, severity = 'info', details = {}) {
  if (!supabase) return
  try {
    await supabase.rpc('log_security_event', {
      p_event_type: eventType,
      p_severity: severity,
      p_details: sanitize(details),
      p_user_agent: userAgent(),
    })
  } catch {
    // Auditoria nunca deve quebrar o fluxo do usuario
  }
}

/**
 * Identifica se um erro do Postgres indica violacao de RLS ou de
 * permissao - ou seja, tentativa de tocar em dado que nao e do usuario.
 *
 * 42501 = insufficient_privilege
 * PGRST301 = JWT invalido/ausente na camada da API
 */
export function isAccessViolation(error) {
  if (!error) return false
  const code = String(error.code || '')
  const message = String(error.message || '').toLowerCase()
  return (
    code === '42501' ||
    code === 'PGRST301' ||
    message.includes('row-level security') ||
    message.includes('violates row-level security') ||
    message.includes('permission denied') ||
    message.includes('nao permitida')
  )
}

/**
 * Envolve uma operacao no banco e registra automaticamente qualquer
 * tentativa de acesso indevido.
 *
 * Este e o mecanismo central de deteccao: a RLS bloqueia o acesso e
 * esta funcao documenta que a tentativa aconteceu.
 */
export async function guarded(operation, context = {}) {
  const result = await operation()
  if (result?.error && isAccessViolation(result.error)) {
    await logEvent(EVENTS.RLS_VIOLATION, 'critical', {
      ...context,
      db_code: String(result.error.code || 'desconhecido'),
    })
  }
  return result
}

/** Ultimos eventos do usuario autenticado (RLS garante o filtro) */
export async function fetchEvents(limit = 60) {
  if (!supabase) return { data: [], error: null }
  const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 100)
  return guarded(
    () => supabase
      .from('security_events')
      .select('id, event_type, severity, created_at')
      .order('created_at', { ascending: false })
      .limit(safeLimit),
    { table: 'security_events', action: 'select' },
  )
}

