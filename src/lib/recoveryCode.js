/**
 * Captura o code/access_token da URL no momento da importacao do modulo,
 * ANTES que qualquer componente React monte ou que o Supabase client
 * remova os parametros da URL via detectSessionInUrl.
 *
 * Isso e necessario porque o AuthProvider (pai) executa seu useEffect
 * antes do ResetPasswordScreen (filho), e a chamada getSession() do
 * Supabase client ja remove o ?code=xxx da URL de forma sincrona.
 * Ao salvar o code aqui, o ResetPasswordScreen sempre tera o valor
 * original independente da ordem dos effects.
 *
 * Uso: import { recoveryCode } from './recoveryCode.js'
 */
const url = new URL(window.location.href)

// PKCE: ?code=xxx
const pkceCode = url.searchParams.get('code')

// Implicit: #access_token=xxx
const hash = url.hash || ''
const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
const implicitToken = hashParams.get('access_token')

/**
 * Code recuperado da URL, ou null se nao houver.
 * Usado como fallback manual em ResetPasswordScreen.
 */
export const recoveryCode = pkceCode || implicitToken

/**
 * Verifier PKCE que viaja no proprio link (?v=), capturado junto com o code.
 *
 * O Supabase guardaria o verifier no localStorage de quem pediu o reset.
 * Quando o link abre em outro navegador (PWA do iOS -> Safari) esse storage
 * nao existe, a troca falha e o usuario ve um erro sem causa aparente.
 * Com o verifier no link, a troca funciona em qualquer contexto.
 */
export const recoveryVerifier = url.searchParams.get('v')
