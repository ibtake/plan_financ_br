import { createClient } from 'npm:@supabase/supabase-js@2'

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

// Gemea byte a byte de selic-sync/index.ts:20. Copia deliberada, nao sobra: o
// deploy destas funcoes e por colagem de um arquivo no painel do Supabase, onde
// nao existe pasta acima da funcao - `supabase/functions/_shared/` so funciona
// com deploy por CLI (backlog B34). Mexer aqui obriga a mexer na gemea: e
// comparacao em tempo constante, e a copia esquecida nao acusa erro nenhum.
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
    if (error) throw new Error('cleanup_failed', { cause: error })
    return response(200, { ok: true, deleted: Number(data) || 0 })
  } catch (error) {
    // Mesmo formato do selic-sync:151 (e do admin-users:199): resposta generica
    // ao chamador, motivo nos logs do projeto. Aqui a causa importa porque o
    // grant da RPC ja foi mexido tres vezes (schema.sql:1553, :1560, :1561) -
    // um 42501 no log e a diferenca entre "permissao caiu" e "banco fora".
    const cause = (error instanceof Error ? error.cause : null) as { code?: unknown } | null
    console.error('reverse_goal_cleanup_failed', {
      stage: error instanceof Error ? error.message : 'unknown',
      detail: String(cause?.code ?? 'unknown'),
    })
    return response(503, { error: 'Limpeza temporariamente indisponível.' })
  }
})
