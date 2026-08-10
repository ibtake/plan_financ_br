import { createClient } from 'npm:@supabase/supabase-js@2'

const encoder = new TextEncoder()
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-application-name', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  if (request.method !== 'POST') return response(405, { error: 'Método não permitido.' })
  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const authorization = request.headers.get('authorization') || ''
  if (!url || !serviceRole || !anonKey || !authorization.startsWith('Bearer ')) return response(401, { error: 'Sessão inválida.' })
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await userClient.auth.getUser(authorization.slice(7))
  if (error || !data.user) return response(401, { error: 'Sessão inválida.' })
  const code = crypto.randomUUID().replaceAll('-', '')
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* corpo vazio */ }
  if (body.action === 'status') {
    const { data: tokens, error: statusError } = await admin
      .from('widget_tokens')
      .select('id,created_at,last_used_at,revoked_at')
      .eq('user_id', data.user.id)
      .order('created_at', { ascending: false })
    return statusError ? response(503, { error: 'Não foi possível consultar os widgets.' }) : response(200, { tokens: tokens || [] })
  }
  if (body.action === 'revoke') {
    const { error: revokeError } = await admin.from('widget_tokens').update({ revoked_at: new Date().toISOString() }).eq('user_id', data.user.id).is('revoked_at', null)
    return revokeError ? response(503, { error: 'Não foi possível revogar o widget.' }) : response(200, { ok: true })
  }
  const { error: insertError } = await admin.from('widget_install_codes').insert({ user_id: data.user.id, code_hash: await hash(code), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
  if (insertError) return response(503, { error: 'Não foi possível iniciar a configuração.' })
  return response(200, { code, expiresIn: 600 })
})
