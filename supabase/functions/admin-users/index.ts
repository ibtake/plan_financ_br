// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 16_384
const MFA_FRESHNESS_SECONDS = 5 * 60

// Copia literal de widget-setup/index.ts; a terceira esta em widget-data, que
// checa content-length dentro da funcao. Aqui a checagem fica no handler, antes
// da autenticacao (:112). As tres seguem copiadas: `_shared/` exige deploy por
// CLI, e o desta app e colagem no painel do Supabase (backlog B34).
async function readJsonWithinLimit(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid_body')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large')
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const body = JSON.parse(new TextDecoder().decode(bytes))
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body')
  return body as Record<string, unknown>
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') || ''
  const configured = String(Deno.env.get('APP_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const allowOrigin = configured.includes(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    // x-application-name e x-client-info sao injetados pelo cliente Supabase
    // do frontend (src/lib/supabase.js). Sem declara-los aqui o preflight falha.
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, x-client-info, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function response(request: Request, status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
      ...extraHeaders,
    },
  })
}

function isStrongPassword(value: unknown) {
  const password = String(value || '')
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((rule) =>
    rule.test(password),
  ).length
  return password.length >= 10 && password.length <= 128 && variety >= 3
}

function validEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function allowedAdminIds() {
  return new Set(
    String(Deno.env.get('APP_ADMIN_USER_IDS') || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

function hasFreshMfa(payload: Record<string, unknown>) {
  if (payload.aal !== 'aal2') return false
  const amr = Array.isArray(payload.amr) ? payload.amr : []
  const mfaEntries = amr.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const method = String((entry as Record<string, unknown>).method || '').toLowerCase()
    return method === 'totp' || method === 'mfa'
  }) as Array<Record<string, unknown>>
  const latest = Math.max(...mfaEntries.map((entry) => Number(entry.timestamp || 0)), 0)
  return latest > 0 && Math.floor(Date.now() / 1000) - latest <= MFA_FRESHNESS_SECONDS
}

// TASK-005: teto no Upstash ANTES da RPC. Sob flood a requisicao morre aqui e
// nao gasta ida ao Postgres nem escrita em admin_action_rate_limits; quando o
// Redis PERMITE, a RPC continua sendo chamada e segue a fonte de verdade.
// REST API por fetch, sem cliente npm: o Deno 2 resolve `npm:` pelo node_modules
// do app (ha package.json na raiz), entao `npm:@upstash/redis` exigiria entrar no
// package.json - proibido pelo card. `EXPIRE ... NX` marca o TTL so na primeira
// requisicao da janela, reproduzindo a janela fixa de 1 minuto da RPC numa unica
// ida HTTP; o TTL da mesma resposta vira o Retry-After, que aqui era estatico.
// Segredo ausente, timeout ou erro devolvem null e a decisao volta a ser
// exclusivamente da RPC - fail-open no gate, o 503 da RPC segue fail-closed.
// Copia de widget-data/index.ts (a terceira esta em widget-setup): o deploy e por
// colagem no painel e `_shared/` exige CLI (backlog B34).
async function consumeRedisLimit(key: string, limit: number, windowSeconds: number) {
  const base = Deno.env.get('UPSTASH_REDIS_REST_URL') || ''
  const token = Deno.env.get('UPSTASH_REDIS_REST_TOKEN') || ''
  if (!base || !token) return null
  try {
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, windowSeconds, 'NX'], ['TTL', key]]),
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    const rows = await res.json() as Array<{ result?: unknown }>
    const count = Number(rows[0]?.result)
    if (!Number.isFinite(count) || count < 1) return null
    const ttl = Number(rows[2]?.result)
    return { allowed: count <= limit, retryAfter: ttl > 0 ? ttl : windowSeconds }
  } catch {
    return null
  }
}

// Espelha o `case` de consume_admin_rate_limit (schema.sql:402); 'status' cai no
// default 60. Duas chamadas no handler compartilham este gate.
const ADMIN_REDIS_LIMITS: Record<string, number> = {
  'create-user': 5,
  'list-users': 30,
  'widget-metrics': 30,
  'complete-password-change': 10,
}

async function enforceAdminRedisLimit(request: Request, adminId: string, action: string) {
  const redis = await consumeRedisLimit(`arl:${action}:${adminId}`, ADMIN_REDIS_LIMITS[action] ?? 60, 60)
  return redis && !redis.allowed
    ? response(request, 429, { error: 'Muitas solicitações. Aguarde um minuto.' }, { 'Retry-After': String(redis.retryAfter) })
    : null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(request)
    if (!headers['Access-Control-Allow-Origin']) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'POST') return response(request, 405, { error: 'Método não permitido.' })

  const origin = request.headers.get('origin') || ''
  const allowedOrigins = String(Deno.env.get('APP_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (!allowedOrigins.includes(origin)) return response(request, 403, { error: 'Origem não autorizada.' })

  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY_BYTES) {
    return response(request, 413, { error: 'Requisição muito grande.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization') || ''

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization.startsWith('Bearer ')) {
    return response(request, 401, { error: 'Não autorizado.' })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const token = authorization.slice('Bearer '.length)
  const { data: authData, error: authError } = await userClient.auth.getUser(token)
  const user = authData.user

  if (authError || !user) return response(request, 401, { error: 'Sessão inválida.' })
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token)
  if (claimsError || !claimsData?.claims) {
    return response(request, 401, { error: 'Sessão inválida.' })
  }
  // Revogacao por atualizacao do usuario (mesma condicao do is_token_valid):
  // token emitido antes da ultima atualizacao - ex.: troca de senha - e
  // invalido mesmo com assinatura valida. Grace de 1s igual ao banco.
  const adminClaims = claimsData.claims as Record<string, unknown>
  const adminTokenIat = Number(adminClaims.iat || 0)
  const adminUserUpdatedEpoch = Math.floor((Date.parse(user.updated_at || '') || 0) / 1000)
  if (!adminTokenIat || !adminUserUpdatedEpoch || adminTokenIat + 1 < adminUserUpdatedEpoch) {
    return response(request, 401, { error: 'Sessão expirada. Entre novamente.' })
  }

  let body: Record<string, unknown>
  try {
    body = await readJsonWithinLimit(request)
  } catch (error) {
    if (error instanceof Error && error.message === 'body_too_large') {
      return response(request, 413, { error: 'Requisição muito grande.' })
    }
    return response(request, 400, { error: 'Corpo da requisição inválido.' })
  }

  const action = String(body.action || '')
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (action === 'complete-password-change') {
    // String() para ler o flag como o banco le: schema.sql:132 usa `->>`, que
    // serializa qualquer tipo JSONB em texto. Aqui a leitura frouxa e o que
    // evita trancamento - este e o portao do proprio remedio, e um valor
    // string 'true' negaria a troca enquanto is_token_valid (que casa a
    // string) negaria todo o plano de dados.
    if (String(user.app_metadata?.must_change_password) !== 'true') {
      return response(request, 403, { error: 'A troca inicial de senha não está pendente.' })
    }
    // v42: unica acao mutante atendida antes da checagem administrativa
    // (usuario comum em primeiro login); exige o mesmo teto server-side.
    const redisBlocked = await enforceAdminRedisLimit(request, user.id, action)
    if (redisBlocked) return redisBlocked
    const { data: allowed, error: rateError } = await admin.rpc('consume_admin_rate_limit', {
      p_admin_id: user.id,
      p_action: action,
    })
    if (rateError) return response(request, 503, { error: 'Proteção temporariamente indisponível.' })
    // Janela fixa de 1 minuto na RPC (v42): Retry-After e estatico.
    if (!allowed) return response(request, 429, { error: 'Muitas solicitações. Aguarde um minuto.' }, { 'Retry-After': '60' })
    if (!isStrongPassword(body.password)) {
      return response(request, 400, { error: 'A nova senha não atende à política de segurança.' })
    }
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: String(body.password),
      app_metadata: { ...user.app_metadata, must_change_password: false },
    })
    if (error) {
      return response(request, 500, { error: 'Não foi possível concluir a troca de senha.' })
    }
    // Credencial emitida na janela da senha temporaria morre junto com ela:
    // revoga widgets ativos e invalida codigos de instalacao nao usados.
    // Falha nunca e silenciosa - o acesso sobrevivente e o proprio bug.
    const nowIso = new Date().toISOString()
    const { data: revokedWidgets, error: revokeError } = await admin
      .from('widget_tokens')
      .update({ revoked_at: nowIso })
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .select('id')
    const { data: voidedCodes, error: codesError } = await admin
      .from('widget_install_codes')
      .update({ used_at: nowIso })
      .eq('user_id', user.id)
      .is('used_at', null)
      .select('id')
    if (revokeError || codesError) {
      console.error('initial_password_change_widget_revoke_failed', {
        userId: user.id,
        revokeError: revokeError?.code || null,
        codesError: codesError?.code || null,
      })
      return response(request, 503, {
        error: 'A senha foi alterada, mas não foi possível revogar as credenciais do widget.',
        code: 'widget_revocation_failed',
        password_changed: true,
      })
    }
    const { error: auditError } = await admin.from('security_events').insert({
      user_id: user.id,
      event_type: 'password_changed',
      severity: 'warning',
      details: {
        context: 'initial_password_change',
        widgets_revoked: revokedWidgets?.length || 0,
        install_codes_voided: voidedCodes?.length || 0,
      },
      user_agent: 'admin-users',
    })
    if (auditError) {
      console.error('initial_password_change_audit_failed', { userId: user.id, errorCode: auditError.code || 'unknown' })
      return response(request, 503, {
        error: 'A senha foi alterada, mas não foi possível registrar o evento de segurança.',
        code: 'password_audit_failed',
        password_changed: true,
      })
    }
    return response(request, 200, { ok: true })
  }

  // Predicado de sessao para todas as demais acoes: troca inicial pendente
  // (complete-password-change acima e a unica isenta - e o proprio fluxo
  // de remediacao). Registro do servidor OU claim, como no is_token_valid.
  // O `=== 'true'` no claim era ramo morto: o unico escritor do campo grava
  // boolean (:328) e getClaims() nao tipa o valor, entao a comparacao nem
  // compilava (TS2339). String() cobre os dois formatos, igual ao `->>`.
  const adminClaimFlag = (adminClaims.app_metadata as { must_change_password?: unknown } | undefined)?.must_change_password
  if (String(user.app_metadata?.must_change_password) === 'true' || String(adminClaimFlag) === 'true') {
    return response(request, 403, { error: 'Conclua a troca de senha antes de continuar.', code: 'password_change_required' })
  }

  if (!allowedAdminIds().has(user.id.toLowerCase())) {
    return response(request, 403, { error: 'Acesso administrativo não autorizado.' })
  }

  if (['status', 'list-users', 'create-user', 'widget-metrics'].includes(action)) {
    const redisBlocked = await enforceAdminRedisLimit(request, user.id, action)
    if (redisBlocked) return redisBlocked
    const { data: allowed, error: rateError } = await admin.rpc('consume_admin_rate_limit', {
      p_admin_id: user.id,
      p_action: action,
    })
    if (rateError) return response(request, 503, { error: 'Proteção temporariamente indisponível.' })
    if (!allowed) return response(request, 429, { error: 'Muitas solicitações. Aguarde um minuto.' }, { 'Retry-After': '60' })
  }

  if (action === 'status') {
    return response(request, 200, { admin: true, aal: claimsData.claims.aal || 'aal1' })
  }

  if (claimsData.claims.aal !== 'aal2') {
    return response(request, 403, {
      error: 'Ative e confirme a verificação em duas etapas para acessar a administração.',
      code: 'aal2_required',
    })
  }

  if (action === 'list-users') {
    // Pentest 16/08: diretorio de usuarios e PII — exige o mesmo step-up
    // de MFA fresco (<=5 min) ja aplicado ao create-user.
    if (!hasFreshMfa(claimsData.claims as Record<string, unknown>)) {
      return response(request, 403, {
        error: 'Confirme novamente seu código MFA antes de listar os usuários.',
        code: 'fresh_mfa_required',
      })
    }
    const users: Array<{ id: string; email: string; fullName: string; createdAt: string }> = []
    let truncated = false
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
      if (error) return response(request, 500, { error: 'Não foi possível listar os usuários.' })
      users.push(
        ...data.users.map((item) => ({
          id: item.id,
          email: item.email || '',
          fullName: String(item.user_metadata?.full_name || ''),
          createdAt: item.created_at,
        })),
      )
      if (data.users.length < 100) break
      if (page === 10) {
        const { data: probe, error: probeError } = await admin.auth.admin.listUsers({ page: 11, perPage: 1 })
        if (probeError) return response(request, 500, { error: 'NÃ£o foi possÃ­vel listar os usuÃ¡rios.' })
        truncated = probe.users.length > 0
      }
    }
    users.sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'))
    return response(request, 200, { users, truncated })
  }

  if (action === 'widget-metrics') {
    // Pentest 16/08: metricas de autenticacao do widget — mesmo step-up.
    if (!hasFreshMfa(claimsData.claims as Record<string, unknown>)) {
      return response(request, 403, {
        error: 'Confirme novamente seu código MFA antes de consultar as métricas.',
        code: 'fresh_mfa_required',
      })
    }
    const { data, error } = await admin
      .from('widget_auth_metrics')
      .select('metric_date,failure_type,sampled_count,last_sampled_at')
      .gte('metric_date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
      .order('metric_date', { ascending: false })
      .order('failure_type', { ascending: true })
    if (error) return response(request, 503, { error: 'Não foi possível consultar as métricas do widget.' })
    return response(request, 200, { sampleRate: 0.1, metrics: data || [] })
  }

  if (action === 'create-user') {
    if (!hasFreshMfa(claimsData.claims as Record<string, unknown>)) {
      return response(request, 403, {
        error: 'Confirme novamente seu código MFA antes de criar o usuário.',
        code: 'fresh_mfa_required',
      })
    }

    const email = validEmail(body.email)
    const fullName = String(body.fullName || '').trim().slice(0, 120)
    const password = String(body.password || '')
    if (!email || !fullName || !isStrongPassword(password)) {
      return response(request, 400, { error: 'Nome, e-mail ou senha temporária inválidos.' })
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { must_change_password: true, created_by_admin: user.id },
    })
    if (error) {
      const duplicate = /already|registered|exists/i.test(error.message)
      return response(request, duplicate ? 409 : 500, {
        error: duplicate
          ? 'Não foi possível criar uma nova conta com esse e-mail.'
          : 'Não foi possível criar o usuário.',
      })
    }

    return response(request, 201, {
      user: {
        id: data.user.id,
        email: data.user.email || email,
        fullName,
        createdAt: data.user.created_at,
      },
    })
  }

  return response(request, 400, { error: 'Ação inválida.' })
})
