import { supabase } from './supabase.js'

export async function callAdminApi(action, payload = {}) {
  if (!supabase) return { error: 'Supabase não configurado.' }
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return { error: 'Sessão expirada. Entre novamente.' }

  const { data, error } = await supabase.functions.invoke('admin-users', {
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...payload },
  })

  if (!error) return { data }
  let message = data?.error || error.message || 'Não foi possível concluir a operação.'
  try {
    const contextData = await error.context?.json()
    message = contextData?.error || message
    return { error: message, code: contextData?.code }
  } catch {
    return { error: message }
  }
}