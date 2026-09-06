// Predicado puro compartilhado entre authOperations (app) e o teste.
// Fica isolado de proposito: importar authOperations no node:test puxaria
// supabase.js, que le import.meta.env no load e estoura fora do Vite.

// O auth-js beta chama Response.json() nas rotas de passkey update/delete, que
// respondem corpo vazio: o parse estoura com AuthUnknownError mesmo quando o
// servidor aplicou. Reconhecemos esse caso para confirmar o efeito via list(),
// em vez de reportar o erro do SDK (medido na Fase 0 do IMPR-010).
export const corpoVazioDoSdk = (erro) => (
  erro?.name === 'AuthUnknownError' &&
  /Unexpected end of JSON input|Failed to execute 'json'/.test(erro?.message ?? '')
)
