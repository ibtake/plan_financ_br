// AUDT-026: nucleo puro da leitura de fatores MFA, testavel sem render nem SDK.
// Erro de leitura sai como { error } distinto do array vazio (mesmo idioma do
// refreshAssurance em authSession.js), para o chamador nao confundir "falha de
// leitura" com "conta sem MFA". Vive em arquivo proprio para o teste nao arrastar
// o singleton supabase.js (que le import.meta.env no load).
export function normalizeFactors({ data, error } = {}) {
  if (error) return { error }
  return { factors: (data?.totp || []).filter((f) => f.status === 'verified') }
}

// BUG-009: predicado de "precisa confirmar MFA antes de trocar a senha", derivado
// do assurance (refreshAssurance). MFA habilitado = nextLevel 'aal2'; falta subir
// quando a sessao ainda esta em aal1. Sem MFA (nextLevel != 'aal2'), aal2 e
// inatingivel e a troca segue em aal1. Puro para o teste cobrir sem SDK nem render.
export function needsMfaBeforePasswordChange(assurance) {
  return assurance?.nextLevel === 'aal2' && assurance?.currentLevel !== 'aal2'
}
