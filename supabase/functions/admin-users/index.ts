// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 16_384
const MFA_FRESHNESS_SECONDS = 5 * 60

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
  const allowOrigin = configured.includes(origin) ? origin : configured[0] || ''
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

function response(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
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
    if (user.app_metadata?.must_change_password !== true) {
      return response(request, 403, { error: 'A troca inicial de senha não está pendente.' })
    }
    // v42: unica acao mutante atendida antes da checagem administrativa
    // (usuario comum em primeiro login); exige o mesmo teto server-side.
    const { data: allowed, error: rateError } = await admin.rpc('consume_admin_rate_limit', {
      p_admin_id: user.id,
      p_action: action,
    })
    if (rateError) return response(request, 503, { error: 'Proteção temporariamente indisponível.' })
    if (!allowed) return response(request, 429, { error: 'Muitas solicitações. Aguarde um minuto.' })
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
    const { error: auditError } = await admin.from('security_events').insert({
      user_id: user.id,
      event_type: 'password_changed',
      severity: 'warning',
      details: { context: 'initial_password_change' },
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

  if (!allowedAdminIds().has(user.id.toLowerCase())) {
    return response(request, 403, { error: 'Acesso administrativo não autorizado.' })
  }

  if (['status', 'list-users', 'create-user', 'widget-metrics'].includes(action)) {
    const { data: allowed, error: rateError } = await admin.rpc('consume_admin_rate_limit', {
      p_admin_id: user.id,
      p_action: action,
    })
    if (rateError) return response(request, 503, { error: 'Proteção temporariamente indisponível.' })
    if (!allowed) return response(request, 429, { error: 'Muitas solicitações. Aguarde um minuto.' })
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
    const users: Array<{ id: string; email: string; fullName: string; createdAt: string }> = []
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
    }
    users.sort((a, b) => a.email.localeCompare(b.email, 'pt-BR'))
    return response(request, 200, { users })
  }

  if (action === 'widget-metrics') {
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
