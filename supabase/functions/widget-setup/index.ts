import { createClient } from 'npm:@supabase/supabase-js@2'

const encoder = new TextEncoder()
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') || ''
  const allowedOrigins = String(Deno.env.get('APP_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (!origin || !allowedOrigins.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function response(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(request)
    if (!headers['Access-Control-Allow-Origin']) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'POST') return response(request, 405, { error: 'Método não permitido.' })
  if (request.headers.get('origin') && !corsHeaders(request)['Access-Control-Allow-Origin']) return response(request, 403, { error: 'Origem não autorizada.' })
  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const authorization = request.headers.get('authorization') || ''
  if (!url || !serviceRole || !anonKey || !authorization.startsWith('Bearer ')) return response(request, 401, { error: 'Sessão inválida.' })
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const token = authorization.slice(7)
  const { data, error } = await userClient.auth.getUser(token)
  if (error || !data.user) return response(request, 401, { error: 'Sessão inválida.' })
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  // Paridade com has_required_aal() do banco: sessao precisa ser AAL2 SOMENTE
  // quando o usuario possui fator MFA verificado. Sessao AAL1 com fator
  // verificado nao emite/gerencia credenciais do widget (evita leitura
  // persistente dos dados com apenas a senha da vitima).
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token)
  if (claimsError || !claimsData?.claims) return response(request, 401, { error: 'Sessão inválida.' })
  const claims = claimsData.claims as Record<string, unknown>
  // Predicado COMPLETO de is_token_valid() replicado na camada de aplicacao
  // (service_role nao passa por RLS). Condicao 1: troca inicial de senha
  // pendente - registro do servidor (fonte da verdade) OU claim do JWT.
  if (data.user.app_metadata?.must_change_password === true || claims.app_metadata?.must_change_password === 'true') {
    return response(request, 403, { error: 'Conclua a troca de senha antes de configurar o widget.', code: 'password_change_required' })
  }
  // Condicao 2: revogacao por atualizacao do usuario - token emitido antes
  // da ultima atualizacao (ex.: troca de senha) e invalido, mesmo com
  // assinatura valida. Mesmo grace de 1s do banco.
  const tokenIat = Number(claims.iat || 0)
  const userUpdatedEpoch = Math.floor((Date.parse(data.user.updated_at || '') || 0) / 1000)
  if (!tokenIat || !userUpdatedEpoch || tokenIat + 1 < userUpdatedEpoch) {
    return response(request, 401, { error: 'Sessão expirada. Entre novamente.' })
  }
  // Condicao 3 (has_required_aal): sessao precisa ser AAL2 SOMENTE quando o
  // usuario possui fator MFA verificado. Sessao AAL1 com fator verificado
  // nao emite/gerencia credenciais do widget.
  if (claimsData.claims.aal !== 'aal2') {
    const { data: factors, error: factorsError } = await admin.auth.admin.mfa.listFactors({ userId: data.user.id })
    if (factorsError) return response(request, 503, { error: 'Não foi possível validar a verificação em duas etapas.' })
    const hasVerifiedFactor = (factors?.factors || []).some((factor) => factor.status === 'verified')
    if (hasVerifiedFactor) {
      return response(request, 403, {
        error: 'Confirme a verificação em duas etapas para gerenciar o widget.',
        code: 'aal2_required',
      })
    }
  }
  const code = crypto.randomUUID().replaceAll('-', '')
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* corpo vazio */ }
  if (body.action !== undefined && body.action !== 'status' && body.action !== 'revoke') {
    return response(request, 400, { error: 'Ação inválida.' })
  }
  if (body.action === 'status') {
    const { data: tokens, error: statusError } = await admin
      .from('widget_tokens')
      .select('id,created_at,last_used_at,revoked_at')
      .eq('user_id', data.user.id)
      .order('created_at', { ascending: false })
    return statusError ? response(request, 503, { error: 'Não foi possível consultar os widgets.' }) : response(request, 200, { tokens: tokens || [] })
  }
  if (body.action === 'revoke') {
    const { error: revokeError } = await admin.from('widget_tokens').update({ revoked_at: new Date().toISOString() }).eq('user_id', data.user.id).is('revoked_at', null)
    return revokeError ? response(request, 503, { error: 'Não foi possível revogar o widget.' }) : response(request, 200, { ok: true })
  }
  // Purga dos codigos do usuario que ja venceram ou foram usados, ANTES de
  // emitir um novo. So saem os vencidos/usados; ativos e nao usados ficam
  // (o fluxo legitimo precisa de apenas um, mas a convivencia nao atrapalha;
  // um segundo dispositivo pode estar configurando enquanto o antigo ainda
  // vigora). Best-effort: falha da limpeza nao bloqueia a emissao.
  await admin
    .from('widget_install_codes')
    .delete()
    .eq('user_id', data.user.id)
    .or(`expires_at.lt.${new Date().toISOString()},used_at.not.is.null`)
  const { error: insertError } = await admin.from('widget_install_codes').insert({ user_id: data.user.id, code_hash: await hash(code), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
  if (insertError) return response(request, 503, { error: 'Não foi possível iniciar a configuração.' })
  return response(request, 200, { code, expiresIn: 600 })
})
