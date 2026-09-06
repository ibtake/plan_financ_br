// =====================================================================
// Deteccao de passkey Apple sincronizavel (IMPR-010)
// =====================================================================
// Modulo folha, sem imports: o teste roda em node:test e nao pode puxar
// supabase.js, que le import.meta.env no load e estoura fora do Vite.
//
// A passkey do iCloud sincroniza sozinha entre aparelhos Apple do mesmo Apple
// ID. Se o servidor confirma uma passkey "Apple Passwords" e ESTE aparelho e
// Apple mas nao tem a marca local, a credencial ja esta aqui - falta so marcar
// para o cracha aparecer. Marcar NAO registra passkey nova.

/** iPhone/iPad/iPod/Mac. Basta o UA: so decide se OFERECEMOS a marca. */
export function isAppleDevice(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  return /iphone|ipad|ipod|macintosh|mac os x/i.test(String(ua || ''))
}

// O servidor grava no friendly_name o nome do autenticador ("Apple Passwords"
// no Apple, algo da Microsoft no Windows Hello) - ignora o nome que mandamos no
// registro. Match largo por "apple" cobre variacoes sem casar Windows Hello.
export function hasAppleServerPasskey(list) {
  return (list ?? []).some((p) => /apple/i.test(String(p?.friendly_name || '')))
}

/**
 * Decide se o cartao de sincronizacao Apple aparece apos o login. Puro: o
 * aparelho (ua) e a lista do servidor sao injetados. Sempre que detectado -
 * sem probabilidade: e informacao util uma vez, some depois de marcar.
 */
export function shouldOfferAppleSync({ freshLogin, hasLocalMark, passkeyList, ua }) {
  if (!freshLogin || hasLocalMark) return false
  return isAppleDevice(ua) && hasAppleServerPasskey(passkeyList)
}
