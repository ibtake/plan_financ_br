// =====================================================================
// Interstitio de chave de acesso pos-login (IMPR-010)
// =====================================================================
// Cartao mostrado apos o login, no lugar do banner antigo dentro do app (que
// "nao valia de nada"). O App.jsx ja garantiu o pre-requisito barato (login
// novo, suporte a WebAuthn, sem marca local); aqui decidimos async o que
// mostrar, porque so aqui podemos chamar listPasskeys():
//   - sync Apple: o servidor tem passkey Apple e este aparelho e Apple -> a
//     passkey do iCloud ja sincronizou pra ca, so falta a marca local. Ativar
//     NAO registra nada, so liga a marca (o cracha passa a aparecer). Sempre
//     que detectado (some depois de marcar), sem probabilidade.
//   - oferta de registro: ~1 em cada 3, para quem nao tem passkey nenhuma.
//   - nada: segue direto pro app (onDone).
// Sem persistencia de dispensa: a aleatoriedade (registro) e a marca (sync)
// ja raleiam a reaparicao.

import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { rememberedAccounts } from '../../lib/rememberedAccounts.js'
import { OFFER_PROBABILITY } from '../../lib/passkeyOffer.js'
import { isAppleDevice, hasAppleServerPasskey } from '../../lib/passkeySync.js'

export default function PasskeyOffer({ onSkip, onDone }) {
  const auth = useAuth()
  // null = ainda decidindo; 'register' | 'sync' = o cartao a mostrar.
  const [modo, setModo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Decide uma vez no mount. listPasskeys() confirma NO SERVIDOR se ha passkey
  // Apple - a oferta de sync so aparece com a credencial comprovadamente la.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data: lista } = await auth.listPasskeys()
      if (!vivo) return
      if (isAppleDevice() && hasAppleServerPasskey(lista)) {
        setModo('sync')
      } else if (Math.random() < OFFER_PROBABILITY) {
        setModo('register')
      } else {
        onDone()
      }
    })()
    return () => { vivo = false }
  }, [auth, onDone])

  // Registro real: cria a passkey neste aparelho (fluxo da tela de Seguranca).
  const cadastrar = async () => {
    setBusy(true); setError('')
    const result = await auth.registerPasskey()
    setBusy(false)
    if (result.error) { setError(result.error); return }
    onDone()
  }

  // Sync: NAO registra. So marca este navegador, ja que a passkey do iCloud
  // ja esta neste aparelho Apple. O cracha passa a aparecer no proximo login.
  const ativarSync = () => {
    const email = auth.session?.user?.email
    if (email) rememberedAccounts.markPasskey(email)
    onDone()
  }

  if (!modo) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="app-loading" style={{ minHeight: 120 }}><div className="spinner" /></div>
        </div>
      </div>
    )
  }

  const sync = modo === 'sync'

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="passkey-offer-hero">
          <span className="passkey-offer-icon" aria-hidden="true">
            <KeyRound size={40} strokeWidth={1.8} />
          </span>
          <h1 className="auth-title" style={{ marginTop: 16 }}>
            {sync ? 'Sua chave de acesso funciona aqui' : 'Habilite já o seu Passkeys'}
          </h1>
          <p className="text-sm text-soft" style={{ marginTop: 8 }}>
            {sync
              ? 'Você já cadastrou uma chave de acesso da Apple em outro aparelho. Ela também funciona neste dispositivo. Ative o acesso rápido por biometria, rosto ou PIN, sem digitar a senha.'
              : 'Entre por biometria, rosto ou PIN do aparelho, sem digitar a senha. Você pode gerenciar as chaves depois no menu de Segurança.'}
          </p>
        </div>

        {error && (
          <div className="notice danger" style={{ marginTop: 16 }} role="alert">{error}</div>
        )}

        <div className="stack" style={{ gap: 10, marginTop: 20 }}>
          {sync ? (
            <button type="button" className="btn btn-primary btn-block" onClick={ativarSync}>
              Ativar acesso rápido
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={cadastrar} disabled={busy} aria-busy={busy}>
              {busy ? 'Aguarde...' : 'Cadastrar'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-block" onClick={onSkip} disabled={busy}>
            {sync ? 'Agora não' : 'Pular'}
          </button>
        </div>
      </div>
    </div>
  )
}
