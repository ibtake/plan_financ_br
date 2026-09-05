import { createClient } from 'npm:@supabase/supabase-js@2'

const BCB_SERIES_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados'
const FETCH_TIMEOUT_MS = 8_000
const MAX_MONTHS_FROM_BCB = 240
const SUPPORTED_HISTORY_MONTHS = 228
// AUDT-008: teto de bytes do corpo do BCB. Cada item da serie ocupa cerca de
// 50 bytes no pior caso (`{"data":"01/12/2025","valor":"12.345678"},` - o
// `parseRate` aceita ate 6 decimais), entao os 240 meses de
// MAX_MONTHS_FROM_BCB cabem em ~12 KB. 64 KiB deixa ~5x de folga.
const MAX_UPSTREAM_BYTES = 65_536

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

// Gemea byte a byte de reverse-goal-cleanup/index.ts:15. Copia deliberada, nao
// sobra: o deploy destas funcoes e por colagem de um arquivo no painel do
// Supabase, onde nao existe pasta acima da funcao - `supabase/functions/_shared/`
// so funciona com deploy por CLI (backlog B34). Mexer aqui obriga a mexer na
// gemea: e comparacao em tempo constante, e a copia esquecida nao acusa erro.
function secureEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  if (!a.length || a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

function monthStart(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) return null
  const [, , month, year] = match
  const numericMonth = Number(month)
  if (numericMonth < 1 || numericMonth > 12) return null
  return `${year}-${month}-01`
}

function parseRate(value: unknown) {
  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!/^\d{1,2}(?:\.\d{1,6})?$/.test(normalized)) return null
  const rate = Number(normalized)
  return Number.isFinite(rate) && rate >= 0 && rate < 100 ? rate : null
}

function formatBcbDate(isoDate: string) {
  const [year, month] = isoDate.slice(0, 7).split('-')
  return `01/${month}/${year}`
}

// Mes corrente no fuso de Brasilia, nao em UTC. O `new Date().toISOString()`
// anterior lia UTC, que das 21:00 as 23:59 de SP ja esta no dia seguinte: no
// ultimo dia do mes isso adiantava o mes inteiro. Como `completedMonth` (`:175`)
// existe justamente para descartar o mes ainda aberto no filtro de `:171`,
// adiantar um mes fazia o mes corrente PASSAR pelo filtro e ser gravado com a
// taxa parcial. E `upsert` roda com `ignoreDuplicates: true` (`:203`), entao esse
// valor nunca seria reescrito quando o mes fechasse - `rebuild_all_reverse_goals`
// (`:206`) o espalharia para as metas reversas de todos os usuarios. Serie mensal
// do BCB e do calendario brasileiro; alinha com `widget-data/index.ts:74` (B40).
function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-01`
}

function supportedStartDate(startDate: string) {
  const limit = new Date()
  limit.setUTCDate(1)
  limit.setUTCHours(0, 0, 0, 0)
  limit.setUTCMonth(limit.getUTCMonth() - SUPPORTED_HISTORY_MONTHS)
  const minimum = limit.toISOString().slice(0, 10)
  return startDate < minimum ? minimum : startDate
}

// AUDT-008: le o corpo do BCB contando bytes em vez de `upstream.json()`, que
// materializava e parseava a resposta inteira antes do teto de `:171` - o limite
// existia, mas atuava depois do custo. Teto medido no STREAM, nao no header,
// entao `chunked` ou content-length ausente tambem ficam limitados. Quarta
// copia do mesmo leitor (`widget-data/index.ts:139` e as outras duas): copia
// deliberada, nao sobra - o deploy destas funcoes e por colagem de um arquivo
// no painel do Supabase, onde `_shared/` nao existe (backlog B34), e mexer
// aqui obriga a mexer nas irmas. Diferenca de proposito: le uma `Response` de
// upstream, nao a `Request` do cliente, e cancela o reader ao estourar para
// nao deixar a conexao pendurada.
async function readUpstreamJsonWithinLimit(upstream: Response): Promise<unknown> {
  const declaredLength = Number(upstream.headers.get('content-length') || 0)
  if (declaredLength > MAX_UPSTREAM_BYTES) {
    throw new Error('bcb_payload_too_large', { cause: { code: `content_length_${declaredLength}` } })
  }
  const reader = upstream.body?.getReader()
  if (!reader) throw new Error('invalid_bcb_payload', { cause: { code: 'no_body' } })
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_UPSTREAM_BYTES) {
      await reader.cancel()
      throw new Error('bcb_payload_too_large', { cause: { code: `stream_${size}` } })
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'Método não permitido.' })
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (!Number.isFinite(declaredLength) || declaredLength > 1_024) {
    return response(413, { error: 'Requisição inválida.' })
  }

  // Fail-closed: sem o secret configurado a funcao fica indisponivel; header
  // vazio jamais pode coincidir com um secret ausente.
  const cronSecret = Deno.env.get('SELIC_SYNC_CRON_SECRET') || ''
  if (!cronSecret) return response(503, { error: 'Serviço temporariamente indisponível.' })
  const suppliedSecret = request.headers.get('x-selic-sync-secret') || ''
  if (!secureEqual(suppliedSecret, cronSecret)) return response(401, { error: 'Não autorizado.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceRoleKey) return response(503, { error: 'Serviço temporariamente indisponível.' })

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { data: oldestGoal, error: goalError } = await admin
      .from('goals')
      .select('reverse_start_date')
      .eq('goal_type', 'reverse')
      .is('reverse_completed_at', null)
      .gt('reverse_remaining_amount', 0)
      .order('reverse_start_date', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (goalError) throw new Error('goals_query_failed', { cause: goalError })
    if (!oldestGoal?.reverse_start_date) return response(200, { ok: true, inserted: 0, rebuilt: 0 })

    const requestedStartDate = String(oldestGoal.reverse_start_date).slice(0, 10)
    const startDate = supportedStartDate(requestedStartDate)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('invalid_goal_date')
    const endpoint = new URL(BCB_SERIES_URL)
    endpoint.searchParams.set('formato', 'json')
    endpoint.searchParams.set('dataInicial', formatBcbDate(startDate))
    endpoint.searchParams.set('dataFinal', formatBcbDate(currentMonth()))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let upstream: Response
    try {
      upstream = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!upstream.ok) throw new Error('bcb_unavailable', { cause: { status: upstream.status } })
    const payload: unknown = await readUpstreamJsonWithinLimit(upstream)
    if (!Array.isArray(payload) || payload.length > MAX_MONTHS_FROM_BCB) {
      throw new Error('invalid_bcb_payload', { cause: { code: Array.isArray(payload) ? `length_${payload.length}` : 'not_array' } })
    }

    const completedMonth = currentMonth()
    const rates = new Map<string, { reference_month: string; rate_percent: number; source_observed_on: string }>()
    for (const item of payload) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const referenceMonth = monthStart(String(row.data || ''))
      const rate = parseRate(row.valor)
      if (!referenceMonth || rate === null || referenceMonth >= completedMonth) continue
      rates.set(referenceMonth, {
        reference_month: referenceMonth,
        rate_percent: rate,
        source_observed_on: referenceMonth,
      })
    }
    if (!rates.size) return response(200, { ok: true, inserted: 0, rebuilt: 0 })

    const months = [...rates.keys()]
    const { data: existing, error: existingError } = await admin
      .from('selic_monthly_rates')
      .select('reference_month')
      .in('reference_month', months)
    if (existingError) throw new Error('rates_query_failed', { cause: existingError })
    const existingMonths = new Set((existing || []).map((row) => String(row.reference_month)))
    const missingRates = [...rates.values()].filter((row) => !existingMonths.has(row.reference_month))
    if (!missingRates.length) return response(200, { ok: true, inserted: 0, rebuilt: 0 })

    const { error: insertError } = await admin
      .from('selic_monthly_rates')
      .upsert(missingRates, { onConflict: 'reference_month', ignoreDuplicates: true })
    if (insertError) throw new Error('rates_insert_failed', { cause: insertError })

    const { data: rebuilt, error: rebuildError } = await admin.rpc('rebuild_all_reverse_goals')
    if (rebuildError) throw new Error('rebuild_failed', { cause: rebuildError })
    return response(200, { ok: true, inserted: missingRates.length, rebuilt: Number(rebuilt) || 0 })
  } catch (error) {
    // Resposta e log sao canais diferentes: o corpo segue generico e o motivo
    // vai para os logs do projeto no formato do admin-users:199 (campos
    // escolhidos, nunca o objeto inteiro). `stage` sai da mensagem dos throws
    // acima e `detail` do `cause` deles - sem o cause o log diria em que etapa
    // parou, nunca por que. Dentro do catch de proposito: secret errado morre
    // no 401 la em cima, fora do try, e nao enche o log de quem chuta segredo.
    const cause = (error instanceof Error ? error.cause : null) as { code?: unknown; status?: unknown } | null
    console.error('selic_sync_failed', {
      stage: error instanceof Error ? error.message : 'unknown',
      detail: String(cause?.code ?? cause?.status ?? 'unknown'),
    })
    return response(503, { error: 'Sincronização temporariamente indisponível.' })
  }
})
