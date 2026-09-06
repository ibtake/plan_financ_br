// =====================================================================
// Oferta de chave de acesso pos-login (IMPR-010)
// =====================================================================
// Cartao interstitial mostrado apos o login, no lugar do banner antigo dentro
// do app (que "nao valia de nada"). A decisao de aparecer - aleatoria, so em
// login novo, so sem marca local - fica no App.jsx via shouldOfferPasskey; aqui
// e so a tela: Cadastrar chama o mesmo registerPasskey() da Seguranca, Pular
// segue direto. Sem persistencia de dispensa: a aleatoriedade ja rala a oferta.

import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'

export default function PasskeyOffer({ onSkip, onDone }) {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ativar = async () => {
    setBusy(true); setError('')
    const result = await auth.registerPasskey()
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onDone()
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="passkey-offer-hero">
          <span className="passkey-offer-icon" aria-hidden="true">
            <KeyRound size={40} strokeWidth={1.8} />
          </span>
          <h1 className="auth-title" style={{ marginTop: 16 }}>Habilite já o seu Passkeys</h1>
          <p className="text-sm text-soft" style={{ marginTop: 8 }}>
            Entre por biometria, rosto ou PIN do aparelho, sem digitar a senha.
            Você pode gerenciar as chaves depois no menu de Segurança.
          </p>
        </div>

        {error && (
          <div className="notice danger" style={{ marginTop: 16 }} role="alert">{error}</div>
        )}

        <div className="stack" style={{ gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-primary btn-block" onClick={ativar} disabled={busy} aria-busy={busy}>
            {busy ? 'Aguarde...' : 'Cadastrar'}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={onSkip} disabled={busy}>
            Pular
          </button>
        </div>
      </div>
    </div>
  )
}
