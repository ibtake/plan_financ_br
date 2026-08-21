import { createClient } from 'npm:@supabase/supabase-js@2'

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
const encoder = new TextEncoder()

function response(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...extraHeaders } })
}

function authLog(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: 'widget_auth', ...fields }))
}

async function recordSampledMetric(admin: ReturnType<typeof createClient>, failureType: 'token' | 'refresh' | 'install_code' | 'unauthorized') {
  // ponytail: amostragem de 10%; trocar por janela global se o volume exigir contagem exata.
  if (Math.random() >= 0.1) return
  // try/catch, nao .catch(): o retorno de .rpc() e um PostgrestFilterBuilder, que
  // e PromiseLike (so tem `then`) e nao Promise. `.catch` aqui lancava TypeError
  // de forma sincrona - antes mesmo de o `then` disparar a requisicao -, entao a
  // metrica nunca chegou ao banco e a excecao subia pelos seis chamadores, todos
  // em caminho de credencial invalida, virando 500 onde a resposta e 401. O
  // `await` funciona em PromiseLike, so o metodo e que nao existia.
  try {
    await admin.rpc('record_widget_auth_metric', { p_failure_type: failureType })
  } catch { /* metrica e best-effort: nunca derruba a requisicao */ }
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Limite por credencial: so e chamado com credencial ja validada. A
// entropia do token (256 bits) e a protecao real contra adivinhacao, por
// isso falha do contador NAO bloqueia o usuario legitimo (fail-open).
async function enforceRateLimit(admin: ReturnType<typeof createClient>, keyHash: string, operation: 'token' | 'refresh' | 'install') {
  const { data, error } = await admin.rpc('consume_widget_rate_limit', { p_key_hash: keyHash, p_operation: operation })
  if (error) {
    authLog({ rateLimit: 'error', operation, errorCode: error.code || null })
    return null
  }
  const result = Array.isArray(data) ? data[0] : data
  if (!result?.allowed) {
    return response(429, { error: 'Muitas tentativas. Tente novamente mais tarde.' }, { 'Retry-After': String(result?.retry_after_seconds || 60) })
  }
  return null
}

// Contador global de credenciais invalidas: unico caminho que persiste
// estado para valores nao verificados. Sem resposta do contador, credencial
// invalida NAO passa (fail-closed) - protege o armazenamento do plano gratuito.
async function enforceInvalidAttemptLimit(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.rpc('consume_widget_invalid_attempt_limit')
  if (error) return response(503, { error: 'Serviço indisponível.' })
  const result = Array.isArray(data) ? data[0] : data
  if (!result?.allowed) {
    return response(429, { error: 'Muitas tentativas. Tente novamente mais tarde.' }, { 'Retry-After': String(result?.retry_after_seconds || 600) })
  }
  return null
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addMonths(date: string, months: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCMonth(value.getUTCMonth() + months)
  return value.toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function monthDiff(from: string, to: string) {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7))
}

// Mesmo clamp de isoDateInMonth (src/utils/format.js:160-164). Sem ele, a conta
// do dia 31 cai em 28/02 no app e a comparacao exata de string a fazia
// desaparecer daqui - o mesmo valia para parcelamento e para recorrencia anual
// iniciada em 29/02. O clamp nao altera o indice, so a comparacao de data, entao
// paid_occurrences[index] segue alinhado com o frontend. Duplicado de proposito:
// importar de src/ arriscaria o bundle do deploy; a consolidacao em _shared/ e o B34.
function isoDateInMonth(monthKey: string, day: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${monthKey}-${String(Math.min(Math.max(1, day || 1), lastDay)).padStart(2, '0')}`
}

function occurrenceDate(tx: Record<string, any>, date: string) {
  const start = String(tx.date).slice(0, 10)
  if (date < start || (tx.recurrence_end && date > String(tx.recurrence_end).slice(0, 10))) return null
  const day = Number(start.slice(8, 10))
  const installments = Number(tx.installments) || 1
  const recurrence = tx.recurrence || 'none'
  if (installments > 1) {
    const index = monthDiff(start, date)
    return index >= 0 && index < installments && date === isoDateInMonth(date.slice(0, 7), day) ? index : null
  }
  if (recurrence === 'none') return date === start ? 0 : null
  if (recurrence === 'weekly') {
    const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000)
    return days >= 0 && days % 7 === 0 ? days / 7 : null
  }
  const steps: Record<string, number> = { monthly: 1, bimonthly: 2, quarterly: 3, yearly: 12 }
  const step = steps[recurrence]
  if (!step) return null
  const index = monthDiff(start, date)
  return index >= 0 && index % step === 0 && date === isoDateInMonth(date.slice(0, 7), day) ? index / step : null
}

// Pentest 16/08: corpo legitimo do widget tem centenas de bytes; 16 KiB e
// folga ampla. Teto medido no STREAM (nao no header), entao chunked/ausencia
// de content-length tambem e limitado - mesmo padrao do admin-users.
const MAX_BODY_BYTES = 16_384

async function readJsonWithinLimit(request: Request): Promise<Record<string, any>> {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY_BYTES) throw new Error('body_too_large')
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
  return body as Record<string, any>
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'Método não permitido.' })
  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !serviceRole) return response(503, { error: 'Serviço indisponível.' })

  let body: Record<string, any>
  try { body = await readJsonWithinLimit(request) } catch (error) {
    if (error instanceof Error && error.message === 'body_too_large') return response(413, { error: 'Requisição muito grande.' })
    return response(400, { error: 'Requisição inválida.' })
  }
  // O widget só pode consultar o dia corrente. A data não vem do cliente.
  const date = saoPauloDate()
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  const widgetToken = request.headers.get('x-widget-token')?.trim() || ''
  const refreshToken = request.headers.get('x-widget-refresh-token')?.trim() || ''
  let userId = ''
  let tokenHash = ''
  let responseToken = ''
  let responseRefreshToken = ''

  // Pentest 16/08: requisicao sem NENHUMA credencial nunca e legitima - o
  // widget sempre envia token, refresh ou codigo. Consome o teto global de
  // invalidas antes de qualquer processamento; antes deste gate, POST vazio
  // era gratuito para flood. Posicionado ANTES dos ramos para nao duplicar a
  // contagem dos caminhos que ja consomem o contador com credencial invalida.
  if (!widgetToken && !refreshToken && !body.code) {
    authLog({ mode: 'none', tokenPresent: false, codePresent: false })
    const invalidLimit = await enforceInvalidAttemptLimit(admin)
    if (invalidLimit) return invalidLimit
    await recordSampledMetric(admin, 'unauthorized')
    return response(401, { error: 'Widget não autorizado.' })
  }

  if (widgetToken) {
    const presentedToken = widgetToken
    tokenHash = await hash(presentedToken)
    // SEC-01: validacao vem ANTES de qualquer contador. Valor invalido
    // nao cria linha por credencial; so incrementa o teto global de
    // tentativas invalidas.
    const { data, error: tokenLookupError } = await admin.from('widget_tokens').select('user_id').eq('token_hash', tokenHash).is('revoked_at', null).gt('access_expires_at', new Date().toISOString()).maybeSingle()
    authLog({ mode: 'token', tokenPresent: Boolean(presentedToken), tokenLength: presentedToken.length, tokenFingerprint: tokenHash.slice(0, 12), tokenFound: Boolean(data), lookupError: tokenLookupError?.code || null })
    if (!data) {
      await recordSampledMetric(admin, 'token')
      const invalidLimit = await enforceInvalidAttemptLimit(admin)
      if (invalidLimit) return invalidLimit
      userId = ''
    } else {
      const rateLimitResponse = await enforceRateLimit(admin, tokenHash, 'token')
      if (rateLimitResponse) return rateLimitResponse
      userId = data.user_id
    }
  }
  if (!userId && refreshToken) {
    const refreshHash = await hash(refreshToken)
    // SEC-01: a existencia do refresh e verificada por leitura antes de
    // qualquer contador; a rotacao atomica (v33) continua sendo a unica
    // fonte de verdade da troca de tokens. Filtros de ciclo de vida iguais
    // aos do caminho do token: credencial revogada ou expirada conta como
    // invalida (telemetria + teto global), nao como credencial valida.
    const { data: refreshRow } = await admin.from('widget_tokens').select('user_id').eq('refresh_token_hash', refreshHash).is('revoked_at', null).gt('refresh_expires_at', new Date().toISOString()).maybeSingle()
    if (!refreshRow) {
      await recordSampledMetric(admin, 'refresh')
      const invalidLimit = await enforceInvalidAttemptLimit(admin)
      if (invalidLimit) return invalidLimit
    } else {
      const rateLimitResponse = await enforceRateLimit(admin, refreshHash, 'refresh')
      if (rateLimitResponse) return rateLimitResponse
      responseToken = randomToken()
      responseRefreshToken = randomToken()
      const responseTokenHash = await hash(responseToken)
      const responseRefreshTokenHash = await hash(responseRefreshToken)
      const { data: rotatedRows, error: refreshError } = await admin.rpc('rotate_widget_refresh_token', {
        p_current_refresh_token_hash: refreshHash,
        p_token_hash: responseTokenHash,
        p_refresh_token_hash: responseRefreshTokenHash,
        p_access_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      if (refreshError) return response(503, { error: 'Não foi possível renovar o widget.' })
      const rotated = Array.isArray(rotatedRows) ? rotatedRows[0] : rotatedRows
      if (rotated?.user_id) {
        userId = rotated.user_id
        tokenHash = responseTokenHash
      } else {
        await recordSampledMetric(admin, 'refresh')
        responseToken = ''
        responseRefreshToken = ''
      }
    }
  }
  if (!userId && body.code) {
    authLog({ mode: 'install_code', codePresent: true })
    const codeHash = await hash(String(body.code))
    // SEC-01: codigo de instalacao e verificado por leitura antes do
    // contador; o consumo atomico (v25) continua na RPC de ativacao.
    const { data: install } = await admin.from('widget_install_codes').select('id,user_id,expires_at,used_at').eq('code_hash', codeHash).maybeSingle()
    const installValid = Boolean(install && !install.used_at && new Date(install.expires_at).getTime() > Date.now())
    authLog({ mode: 'install_code_result', found: Boolean(install), used: Boolean(install?.used_at), valid: installValid })
    if (!installValid) {
      await recordSampledMetric(admin, 'install_code')
      const invalidLimit = await enforceInvalidAttemptLimit(admin)
      if (invalidLimit) return invalidLimit
    }
    if (installValid) {
      const token = randomToken()
      const refresh = randomToken()
      tokenHash = await hash(token)
      const refreshHash = await hash(refresh)
      const { data: activation, error: activationError } = await admin.rpc('activate_widget_install_code', { p_code_hash: codeHash, p_token_hash: tokenHash, p_refresh_token_hash: refreshHash })
      const activated = Array.isArray(activation) ? activation[0] : activation
      authLog({ mode: 'install_code_insert', tokenFingerprint: tokenHash.slice(0, 12), inserted: Boolean(activated), insertError: activationError?.code || null })
      if (activationError) return response(503, { error: 'Não foi possível ativar o widget.' })
      if (!activated) return response(401, { error: 'Widget não autorizado.' })
      userId = activated.user_id
      responseToken = token
      responseRefreshToken = refresh
      authLog({ mode: 'install_code_activated', activated: true })
    }
  }
  // Alcancado somente por credencial apresentada e invalida (os fluxos sem
  // nenhuma credencial retornam no gate inicial). Mantem a metrica e o shape
  // de resposta originais.
  if (!userId) {
    await recordSampledMetric(admin, 'unauthorized')
    return response(401, { error: 'Widget não autorizado.' })
  }

  const { data: rows, error } = await admin.from('transactions').select('description,amount,date,paid,recurrence,recurrence_end,installments,paid_occurrences,type').eq('user_id', userId).eq('type', 'expense')
  if (error) return response(503, { error: 'Não foi possível consultar as contas.' })
  const bills = (rows || []).flatMap((tx) => {
    const index = occurrenceDate(tx, date)
    const paid = index === 0 ? tx.paid !== false : Boolean(tx.paid_occurrences?.[index])
    return index !== null && !paid ? [{ description: String(tx.description).slice(0, 80), amount: Number(tx.amount) || 0, date, installment: Number(tx.installments) > 1 ? `${index + 1}/${tx.installments}` : null }] : []
  })
  if (tokenHash && !responseToken) await admin.from('widget_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', tokenHash)
  return response(200, { date, bills, total: bills.reduce((sum, bill) => sum + bill.amount, 0), ...(responseToken ? { token: responseToken, refreshToken: responseRefreshToken } : {}) })
})
