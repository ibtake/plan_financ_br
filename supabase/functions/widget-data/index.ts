import { createClient } from 'npm:@supabase/supabase-js@2'

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
const encoder = new TextEncoder()

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
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

function occurrenceDate(tx: Record<string, any>, date: string) {
  const start = String(tx.date).slice(0, 10)
  if (date < start || (tx.recurrence_end && date > String(tx.recurrence_end).slice(0, 10))) return null
  const day = String(start).slice(8, 10)
  const installments = Number(tx.installments) || 1
  const recurrence = tx.recurrence || 'none'
  if (installments > 1) {
    const index = monthDiff(start, date)
    return index >= 0 && index < installments && date === `${date.slice(0, 8)}${day}` ? index : null
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
  return index >= 0 && index % step === 0 && date === `${date.slice(0, 8)}${day}` ? index / step : null
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'Método não permitido.' })
  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !serviceRole) return response(503, { error: 'Serviço indisponível.' })

  let body: Record<string, any>
  try { body = await request.json() } catch { return response(400, { error: 'Requisição inválida.' }) }
  // O widget só pode consultar o dia corrente. A data não vem do cliente.
  const date = saoPauloDate()
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
  const authorization = request.headers.get('authorization') || ''
  let userId = ''
  let tokenHash = ''

  if (authorization.startsWith('Bearer ')) {
    tokenHash = await hash(authorization.slice(7))
    const { data } = await admin.from('widget_tokens').select('user_id').eq('token_hash', tokenHash).is('revoked_at', null).maybeSingle()
    userId = data?.user_id || ''
  } else if (body.code) {
    const codeHash = await hash(String(body.code))
    const { data: install } = await admin.from('widget_install_codes').select('id,user_id,expires_at,used_at').eq('code_hash', codeHash).maybeSingle()
    if (install && !install.used_at && new Date(install.expires_at).getTime() > Date.now()) {
      const token = randomToken()
      tokenHash = await hash(token)
      userId = install.user_id
      await admin.from('widget_install_codes').update({ used_at: new Date().toISOString() }).eq('id', install.id)
      const { error } = await admin.from('widget_tokens').insert({ user_id: userId, token_hash: tokenHash })
      if (error) return response(503, { error: 'Não foi possível ativar o widget.' })
      body.__newToken = token
    }
  }
  if (!userId) return response(401, { error: 'Widget não autorizado.' })

  const { data: rows, error } = await admin.from('transactions').select('description,amount,date,paid,recurrence,recurrence_end,installments,paid_occurrences,type').eq('user_id', userId).eq('type', 'expense')
  if (error) return response(503, { error: 'Não foi possível consultar as contas.' })
  const bills = (rows || []).flatMap((tx) => {
    const index = occurrenceDate(tx, date)
    const paid = index === 0 ? tx.paid !== false : Boolean(tx.paid_occurrences?.[index])
    return index !== null && !paid ? [{ description: String(tx.description).slice(0, 80), amount: Number(tx.amount) || 0, date, installment: Number(tx.installments) > 1 ? `${index + 1}/${tx.installments}` : null }] : []
  })
  if (tokenHash) await admin.from('widget_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', tokenHash)
  return response(200, { date, bills, total: bills.reduce((sum, bill) => sum + bill.amount, 0), ...(body.__newToken ? { token: body.__newToken } : {}) })
})
