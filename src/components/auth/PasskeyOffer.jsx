// =====================================================================
// Oferta de chave de acesso no primeiro login (IMPR-010)
// =====================================================================
// Banner discreto pos-login para quem ainda nao registrou passkey NESTE
// navegador. Dispensavel e lembravel: a dispensa fica em localStorage por
// conta, entao nao volta a cada visita. A gestao completa segue no menu de
// Seguranca; aqui e so o atalho de ativacao.

import { useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { rememberedAccounts } from '../../lib/rememberedAccounts.js'

const suportaWebAuthn = typeof window !== 'undefined' && 'PublicKeyCredential' in window
const DISMISS_KEY = 'planejador:passkey-offer-dismissed'

function jaDispensou(email) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '[]')
    return Array.isArray(raw) && raw.includes(email)
  } catch {
    return false
  }
}

function marcarDispensa(email) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '[]')
    const lista = Array.isArray(raw) ? raw : []
    if (!lista.includes(email)) lista.push(email)
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(lista))
  } catch {
    // Sem storage a oferta reaparece na proxima visita; nao e requisito.
  }
}

export default function PasskeyOffer() {
  const auth = useAuth()
  const email = auth.user?.email
  const jaTem = !!email && rememberedAccounts.list().some((a) => a.email === email && a.hasPasskey)
  const [hidden, setHidden] = useState(() => !email || jaTem || jaDispensou(email))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!suportaWebAuthn || hidden) return null

  const ativar = async () => {
    setBusy(true); setError('')
    const result = await auth.registerPasskey()
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setHidden(true)
  }

  const dispensar = () => {
    marcarDispensa(email)
    setHidden(true)
  }

  return (
    <div className="notice info" role="status" style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
      <KeyRound size={20} aria-hidden="true" />
      <div className="grow">
        <strong>Entre mais rápido com biometria</strong>
        <div className="text-sm text-soft">
          Ative a entrada por chave de acesso (passkey) neste aparelho e use a digital, o rosto ou o PIN em vez da senha.
        </div>
        {error && <div className="text-sm" style={{ color: 'var(--danger, #c0392b)', marginTop: 4 }}>{error}</div>}
      </div>
      <div className="settings-actions" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={ativar} disabled={busy} aria-busy={busy}>
          {busy ? 'Aguarde...' : 'Ativar'}
        </button>
        <button type="button" className="icon-btn" onClick={dispensar} aria-label="Dispensar oferta de chave de acesso">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
