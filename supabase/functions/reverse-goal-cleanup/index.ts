import { createClient } from 'npm:@supabase/supabase-js@2'

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

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response(405, { error: 'Método não permitido.' })
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (!Number.isFinite(declaredLength) || declaredLength > 1_024) return response(413, { error: 'Requisição inválida.' })

  // Fail-closed: sem o secret configurado a funcao fica indisponivel; header
  // vazio jamais pode coincidir com um secret ausente.
  const expectedSecret = Deno.env.get('REVERSE_GOAL_CLEANUP_CRON_SECRET') || ''
  if (!expectedSecret) return response(503, { error: 'Serviço temporariamente indisponível.' })
  if (!secureEqual(request.headers.get('x-reverse-goal-cleanup-secret') || '', expectedSecret)) {
    return response(401, { error: 'Não autorizado.' })
  }
  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !serviceRole) return response(503, { error: 'Serviço temporariamente indisponível.' })

  try {
    const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await admin.rpc('cleanup_expired_reverse_goals')
    if (error) throw new Error('cleanup_failed')
    return response(200, { ok: true, deleted: Number(data) || 0 })
  } catch {
    // Nao divulga detalhes de banco, configuracao ou dados eliminados.
    return response(503, { error: 'Limpeza temporariamente indisponível.' })
  }
})
