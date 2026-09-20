// AUDT-026: nucleo puro da leitura de fatores MFA, testavel sem render nem SDK.
// Erro de leitura sai como { error } distinto do array vazio (mesmo idioma do
// refreshAssurance em authSession.js), para o chamador nao confundir "falha de
// leitura" com "conta sem MFA". Vive em arquivo proprio para o teste nao arrastar
// o singleton supabase.js (que le import.meta.env no load).
export function normalizeFactors({ data, error } = {}) {
  if (error) return { error }
  return { factors: (data?.totp || []).filter((f) => f.status === 'verified') }
}
