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

// Oferta de registro aleatoria e nunca toda vez: ~1 em cada 3 logins novos. O
// pre-requisito (login novo, suporte, sem marca) fica no App.jsx; o sorteio e a
// escolha sync-vs-registro ficam no PasskeyOffer, que precisa do listPasskeys().
export const OFFER_PROBABILITY = 1 / 3
