// =====================================================================
// Par PKCE gerado fora do storage do navegador (BUG-003)
// =====================================================================
//
// O fluxo padrao do Supabase grava o code_verifier no localStorage do
// contexto onde o pedido nasceu. Quando o link do e-mail abre em outro
// navegador - o caso do PWA no iOS que redireciona para o Safari - esse
// storage nao existe e a troca falha com AuthPKCECodeVerifierMissingError.
// Gerando o par aqui, o verifier pode viajar no proprio link e a troca
// deixa de depender de onde o pedido nasceu.
//
// Este modulo e puro de proposito: nao le import.meta.env e nao importa o
// client Supabase, para que "node --test" consiga importa-lo.
// =====================================================================

/** 56 bytes -> 112 caracteres hex. O RFC 7636 aceita de 43 a 128. */
const VERIFIER_BYTES = 56

function byteToHex(byte) {
  return `0${byte.toString(16)}`.slice(-2)
}

/** Verifier aleatorio para uma unica troca de codigo. */
export function generateVerifier() {
  const bytes = new Uint8Array(VERIFIER_BYTES)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byteToHex).join('')
}

/**
 * challenge = base64url(SHA-256(verifier)), sem padding.
 * Formato exigido pelo code_challenge_method 's256' do GoTrue.
 */
export async function deriveChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
