// =====================================================================
// Cliente Supabase - ponto unico de acesso ao backend
// =====================================================================
//
// NAO edite este arquivo para colocar suas chaves.
// As credenciais vem do arquivo ".env" (local) ou das variaveis de
// ambiente da Vercel (producao). Veja ".env.example".
//
// SEGURANCA
// A anon key e publica por natureza em apps front-end. O isolamento
// entre usuarios e garantido pelas politicas RLS do banco, definidas
// em supabase/schema.sql - nunca por esconder esta chave.
// =====================================================================

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Placeholders do .env.example que indicam configuracao incompleta */
const PLACEHOLDERS = ['COLE_AQUI_A_URL_DO_SEU_PROJETO', 'COLE_AQUI_A_SUA_ANON_KEY']

function isMissing(value) {
  return !value || PLACEHOLDERS.includes(String(value).trim())
}

/**
 * Indica se o app tem credenciais utilizaveis.
 * Quando falso, a interface mostra instrucoes em vez de quebrar.
 */
export const isSupabaseConfigured = !isMissing(url) && !isMissing(anonKey)

/** Mensagem de diagnostico exibida quando a configuracao esta incompleta */
export function configurationProblem() {
  if (isSupabaseConfigured) return null
  const missing = []
  if (isMissing(url)) missing.push('VITE_SUPABASE_URL')
  if (isMissing(anonKey)) missing.push('VITE_SUPABASE_ANON_KEY')
  return missing
}

// Aviso claro no console durante o desenvolvimento
if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[DinDin 10!] Supabase nao configurado. Defina VITE_SUPABASE_URL e ' +
      'VITE_SUPABASE_ANON_KEY no arquivo .env (veja .env.example).',
  )
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        // Risco aceito: a sessao persistida no navegador aumenta o impacto de XSS.
        // Mitigacoes: CSP, sem HTML arbitrario, logout por inatividade e revogacao no servidor.
        persistSession: true,
        // Renova o token de acesso automaticamente antes de expirar
        autoRefreshToken: true,
        // O fluxo de recuperacao troca o code PKCE explicitamente na tela dedicada.
        detectSessionInUrl: false,
        // PKCE: fluxo recomendado para aplicacoes que rodam no navegador
        flowType: 'pkce',
      },
      global: {
        headers: { 'x-application-name': 'dindin-10' },
      },
    })
  : null

/**
 * Traduz erros do Supabase para portugues.
 *
 * SEGURANCA: credenciais invalidas retornam sempre a mesma mensagem,
 * sem revelar se o e-mail existe na base. Confirmar a existencia de uma
 * conta ajudaria um atacante a enumerar usuarios validos.
 */
export function translateAuthError(error) {
  if (!error) return null
  const raw = String(error.message || error).toLowerCase()

  if (raw.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (raw.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.'
  if (raw.includes('user already registered') || raw.includes('already been registered')) {
    return 'Nao foi possivel concluir o cadastro com estes dados.'
  }
  if (raw.includes('password should be at least')) {
    return 'A senha e muito curta. Use pelo menos 10 caracteres.'
  }
  if (raw.includes('invalid totp') || raw.includes('invalid code') || raw.includes('invalid mfa')) {
    return 'Codigo de verificacao invalido ou expirado. Tente o codigo atual do app.'
  }
  if (raw.includes('mfa_factor_name_conflict')) {
    return 'Ja existe uma configuracao MFA com este nome. Tente ativar novamente.'
  }
  if (raw.includes('too_many_enrolled_mfa_factors')) {
    return 'O limite de fatores MFA foi atingido. Remova um fator antigo e tente novamente.'
  }
  if (raw.includes('mfa_totp_enroll_not_enabled')) {
    return 'A ativacao de MFA por aplicativo esta desabilitada no Supabase.'
  }
  if (raw.includes('mfa_ip_address_mismatch')) {
    return 'A ativacao precisa ser concluida no mesmo dispositivo e rede em que foi iniciada.'
  }
  if (raw.includes('rate limit') || raw.includes('too many requests')) {
    return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.'
  }
  if (raw.includes('failed to fetch') || raw.includes('networkerror')) {
    return 'Falha de conexao. Verifique sua internet e tente novamente.'
  }
  if (raw.includes('row-level security') || raw.includes('permission denied')) {
    return 'Acesso negado pelas regras de seguranca do banco de dados.'
  }
  if (raw.includes('email address') && raw.includes('invalid')) {
    return 'Endereco de e-mail invalido.'
  }

  return 'Nao foi possivel concluir a operacao. Tente novamente.'
}
