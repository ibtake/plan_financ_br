// =====================================================================
// Decisao da oferta de passkey pos-login (IMPR-010)
// =====================================================================
// Modulo folha, sem imports: o teste roda em node:test e nao pode puxar
// supabase.js, que le import.meta.env no load e estoura fora do Vite.

// Sinal de "login novo nesta carga". SIGNED_IN dispara no login real; recarga
// com sessao salva dispara INITIAL_SESSION. A oferta so aparece em login novo,
// nunca em recarga. One-shot: quem consome, zera.
// ponytail: estado de modulo; basta para um SPA de sessao unica.
let freshFlag = false

export function markFreshLogin() {
  freshFlag = true
}

export function takeFreshLogin() {
  const value = freshFlag
  freshFlag = false
  return value
}

// Aleatoria e nunca toda vez: ~1 em cada 3 logins novos.
export const OFFER_PROBABILITY = 1 / 3

/**
 * Decide se o cartao "Habilite ja o seu Passkeys" aparece apos o login.
 * Puro e testavel: `random` e injetavel.
 */
export function shouldOfferPasskey({ supported, hasLocalMark, freshLogin, random = Math.random }) {
  if (!supported || hasLocalMark || !freshLogin) return false
  return random() < OFFER_PROBABILITY
}
