import { createClient } from 'npm:@supabase/supabase-js@2'

const encoder = new TextEncoder()
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const MAX_BODY_BYTES = 16_384

// Copia literal de admin-users/index.ts:11; a terceira copia esta em
// widget-data/index.ts e difere de proposito, checando content-length dentro da
// funcao. Aqui e no admin-users a checagem barata fica no handler, ANTES da
// autenticacao (:69), que e o custo real - foi o ponto do B29.
// As tres continuam copiadas: `supabase/functions/_shared/` exige deploy por
// CLI, e o desta app e colagem de arquivo no painel do Supabase (backlog B34).
// Mexer no limite obriga a mexer nas tres.
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

function corsHeaders(request: Request): Record<string, string> {
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

function response(request: Request, status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(request)
    if (!headers['Access-Control-Allow-Origin']) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'POST') return response(request, 405, { error: 'Método não permitido.' })
  if (request.headers.get('origin') && !corsHeaders(request)['Access-Control-Allow-Origin']) return response(request, 403, { error: 'Origem não autorizada.' })
  // Recusa barata, ANTES das duas a tres chamadas ao Auth abaixo (getUser,
  // getClaims e listFactors quando ha MFA), que sao o custo real por
  // requisicao. O header e declarativo: quem mentir ou usar chunked encoding
  // ainda e cortado na leitura do stream por readJsonWithinLimit.
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY_BYTES) return response(request, 413, { error: 'Requisição muito grande.' })
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
  // (service_role nao passa por RLS). Condicao 2 primeiro, invertendo a ordem
  // do banco (schema.sql:132): o claim de um token velho ainda carrega o flag
  // antigo, e mandar "conclua a troca" para quem acabou de concluir e mentira.
  // "Sessao expirada" e a resposta certa, e e a que o admin-users:140 ja da.
  // Token emitido antes da ultima atualizacao do usuario (ex.: troca de senha)
  // e invalido mesmo com assinatura valida. Mesmo grace de 1s do banco.
  const tokenIat = Number(claims.iat || 0)
  const userUpdatedEpoch = Math.floor((Date.parse(data.user.updated_at || '') || 0) / 1000)
  if (!tokenIat || !userUpdatedEpoch || tokenIat + 1 < userUpdatedEpoch) {
    return response(request, 401, { error: 'Sessão expirada. Entre novamente.' })
  }
  // Condicao 1: troca inicial de senha pendente - registro do servidor (fonte
  // da verdade) OU claim do JWT. String() para o mesmo critério do banco, que
  // le o claim com `->>` e por isso casa boolean true e string 'true'.
  const claimFlag = (claims.app_metadata as { must_change_password?: unknown } | undefined)?.must_change_password
  if (String(data.user.app_metadata?.must_change_password) === 'true' || String(claimFlag) === 'true') {
    return response(request, 403, { error: 'Conclua a troca de senha antes de configurar o widget.', code: 'password_change_required' })
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
  let body: Record<string, unknown> = {}
  try {
    body = await readJsonWithinLimit(request)
  } catch (error) {
    // Corpo ausente ou invalido segue como {}, que e o fluxo de emissao - o
    // comportamento desde a v24, e um bundle antigo em cache pode chamar sem
    // corpo. Trocar isto por 400 quebraria esse cliente. Somente o corpo
    // grande e recusado: seguir ali seria aceitar exatamente a leitura que o
    // limite existe para evitar.
    if (error instanceof Error && error.message === 'body_too_large') {
      return response(request, 413, { error: 'Requisição muito grande.' })
    }
    console.warn('Corpo ausente ou inválido; usando o fluxo legado de emissão do widget.')
    body = {}
  }
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
  // Teto de emissao por usuario. A RPC ja existia com a operacao 'install'
  // (limite 5/min, schema.sql:1125) e nunca havia sido chamada - widget-data
  // usa so 'token' e 'refresh'. A chave e o hash do proprio usuario, que
  // satisfaz o predicado ^[0-9a-f]{64}$ da RPC e nao colide com hash de
  // codigo. Fica DEPOIS dos ramos status/revoke de proposito: o painel chama
  // status a cada montagem (SettingsPanel.jsx:43) e cinco visitas a aba num
  // minuto derrubariam uma tela de leitura.
  //
  // Fail-open igual ao widget-data:38-41: quem chega aqui tem sessao valida,
  // senha ja trocada e AAL2 quando ha MFA, entao falha do contador nao pode
  // impedir a configuracao do widget.
  const { data: rateLimit, error: rateError } = await admin.rpc('consume_widget_rate_limit', { p_key_hash: await hash(data.user.id), p_operation: 'install' })
  const rateRow = Array.isArray(rateLimit) ? rateLimit[0] : rateLimit
  if (!rateError && rateRow && !rateRow.allowed) {
    return response(request, 429, { error: 'Muitas solicitações. Aguarde um instante antes de gerar outro código.' }, { 'Retry-After': String(rateRow.retry_after_seconds || 60) })
  }
  const code = crypto.randomUUID().replaceAll('-', '')
  // Purga dos codigos vencidos e NAO usados do usuario, ANTES de emitir um
  // novo. Codigo usado nao pode sair: widget_tokens.install_code_id o
  // referencia sem cascade (v25), e como nada nunca apaga widget_tokens (o
  // revoke so marca revoked_at), incluir `used_at not null` fazia a instrucao
  // inteira violar a FK - o DELETE falhava por completo e nem os vencidos
  // saiam, em silencio, porque o erro nao e lido. `on delete cascade` seria
  // pior: apagaria o token junto, revogando widget ativo sem aviso.
  // Best-effort mantido: falha da limpeza nao bloqueia a emissao.
  await admin
    .from('widget_install_codes')
    .delete()
    .eq('user_id', data.user.id)
    .lt('expires_at', new Date().toISOString())
    .is('used_at', null)
  const { error: insertError } = await admin.from('widget_install_codes').insert({ user_id: data.user.id, code_hash: await hash(code), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
  if (insertError) return response(request, 503, { error: 'Não foi possível iniciar a configuração.' })
  return response(request, 200, { code, expiresIn: 600 })
})
