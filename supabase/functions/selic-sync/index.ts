import { createClient } from 'npm:@supabase/supabase-js@2'

const BCB_SERIES_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados'
const FETCH_TIMEOUT_MS = 8_000
const MAX_MONTHS_FROM_BCB = 240
const SUPPORTED_HISTORY_MONTHS = 228

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

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

function currentMonth() {
  return new Date().toISOString().slice(0, 7) + '-01'
}

function supportedStartDate(startDate: string) {
  const limit = new Date()
  limit.setUTCDate(1)
  limit.setUTCHours(0, 0, 0, 0)
  limit.setUTCMonth(limit.getUTCMonth() - SUPPORTED_HISTORY_MONTHS)
  const minimum = limit.toISOString().slice(0, 10)
  return startDate < minimum ? minimum : startDate
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'Método não permitido.' })
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (!Number.isFinite(declaredLength) || declaredLength > 1_024) {
    return response(413, { error: 'Requisição inválida.' })
  }

  const cronSecret = Deno.env.get('SELIC_SYNC_CRON_SECRET') || ''
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
    if (goalError) throw new Error('goals_query_failed')
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
    if (!upstream.ok) throw new Error('bcb_unavailable')
    const payload: unknown = await upstream.json()
    if (!Array.isArray(payload) || payload.length > MAX_MONTHS_FROM_BCB) throw new Error('invalid_bcb_payload')

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
    if (existingError) throw new Error('rates_query_failed')
    const existingMonths = new Set((existing || []).map((row) => String(row.reference_month)))
    const missingRates = [...rates.values()].filter((row) => !existingMonths.has(row.reference_month))
    if (!missingRates.length) return response(200, { ok: true, inserted: 0, rebuilt: 0 })

    const { error: insertError } = await admin
      .from('selic_monthly_rates')
      .upsert(missingRates, { onConflict: 'reference_month', ignoreDuplicates: true })
    if (insertError) throw new Error('rates_insert_failed')

    const { data: rebuilt, error: rebuildError } = await admin.rpc('rebuild_all_reverse_goals')
    if (rebuildError) throw new Error('rebuild_failed')
    return response(200, { ok: true, inserted: missingRates.length, rebuilt: Number(rebuilt) || 0 })
  } catch {
    // Nao devolve detalhes de infraestrutura, resposta externa ou banco ao chamador.
    return response(503, { error: 'Sincronização temporariamente indisponível.' })
  }
})
