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

/**
 * Tipos que o frontend emite. Subconjunto da constraint da tabela: o banco
 * tambem aceita 'suspicious_activity' (sem emissor em lugar nenhum do projeto)
 * e 'rate_limited' (emitido pelo proprio banco, ver EVENT_LABELS abaixo).
 */
export const EVENTS = {
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILED: 'login_failed',
  LOGOUT: 'logout',
  // Nunca emitido, e correto: config.toml:4 tem enable_signup = false, logo nao
  // existe cadastro publico - a conta nasce pela function admin-users.
  SIGNUP: 'signup',
  MFA_ENROLLED: 'mfa_enrolled',
  MFA_REMOVED: 'mfa_removed',
  MFA_OK: 'mfa_challenge_success',
  MFA_FAILED: 'mfa_challenge_failed',
  PASSWORD_RESET: 'password_reset_requested',
  PASSWORD_CHANGED: 'password_changed',
  // Quem emite nao e o frontend: delete_my_data grava bulk_delete na mesma
  // transacao do delete (schema.sql:1282-1283), e reset_my_data_with_defaults
  // chama essa funcao - registro transacional, que nao depende de o cliente
  // estar vivo depois do apagamento para acontecer. Nao remova esta constante
  // nem o rotulo em EVENT_LABELS achando que e codigo morto: e o rotulo que
  // nomeia na tela o evento que o banco gravou.
  BULK_DELETE: 'bulk_delete',
  DATA_IMPORTED: 'data_imported',
  RLS_VIOLATION: 'rls_violation_attempt',
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
  // Nenhuma chamada do app emite este tipo - quem grava e o banco. Passados 50
  // eventos comuns na hora, log_security_event para de gravar e registra este
  // uma vez para dizer que descartou o excedente
  // (migrations/20260815174044_v36_critical_audit_quota.sql:52-69). Sem o rotulo
  // aqui, SecurityPanel.jsx:56 caia no fallback e a tela mostrava a string crua
  // 'rate_limited' - justo no momento em que o painel precisa se explicar,
  // porque a lista dali para frente esta incompleta.
  rate_limited: { icon: '⏳', text: 'Registro de eventos pausado por limite na última hora' },
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
 * Chaves de diagnostico do proprio app, isentas do filtro por substring.
 * `db_code` contem 'code' - palavra que barra codigo TOTP e de recuperacao -
 * mas um SQLSTATE nao e segredo, e sem ele o log de violacao de RLS nao
 * distingue o 42501 explicito da recusa reconhecida apenas pelo texto da
 * mensagem ('permission denied', 'row-level security'), que pode ser falta de
 * GRANT em vez de politica.
 * Isencao pontual de proposito: a comparacao exata na lista proibida deixaria
 * passar `recovery_code`, `otp_code` e todo segredo em camelCase.
 */
const ALLOWED_KEYS = ['db_code']

/**
 * Remove qualquer campo sensivel do objeto de detalhes.
 * Rede de seguranca contra vazamento acidental no log.
 */
function sanitize(details) {
  if (!details || typeof details !== 'object') return {}
  const safe = {}
  for (const [key, value] of Object.entries(details)) {
    const lower = key.toLowerCase()
    if (!ALLOWED_KEYS.includes(lower) && FORBIDDEN_KEYS.some((f) => lower.includes(f))) continue
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
 *
 * PGRST301 fica DE FORA de proposito. Ele e sessao expirada - rotina, nao
 * recusa de politica - e useSupabaseFinance.js:101 ja o trata assim, chamando
 * signOut('session_expired'). Enquanto esteve nesta lista, uma carga com token
 * morto classificava as 10 leituras guardadas de load() como acesso indevido e
 * disparava 10 RPCs de log que o banco recusa de saida: log_security_event
 * comeca por `if v_uid is null or not is_token_valid() then return`
 * (migrations/20260815174044_v36_critical_audit_quota.sql:30-32). Dava 10
 * requisicoes de rede, zero linha gravada, e o mesmo codigo de erro
 * classificado de dois jeitos opostos em dois arquivos.
 */
export function isAccessViolation(error) {
  if (!error) return false
  const code = String(error.code || '')
  const message = String(error.message || '').toLowerCase()
  return (
    code === '42501' ||
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

