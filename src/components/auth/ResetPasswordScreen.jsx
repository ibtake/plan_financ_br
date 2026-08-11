import { useEffect, useState } from 'react'
import { useAuth, validatePassword } from '../../contexts/AuthContext.jsx'

export default function ResetPasswordScreen() {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(true)
  const [ready, setReady] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const code = new URLSearchParams(window.location.search).get('code')
    window.history.replaceState({}, document.title, '/reset-password')

    auth.exchangeRecoveryCode(code).then((result) => {
      if (!active) return
      setBusy(false)
      if (result.error) {
        setError(result.error)
        return
      }
      setReady(true)
    })

    return () => { active = false }
  }, [auth.exchangeRecoveryCode])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const strength = validatePassword(password)
    if (!strength.valid) {
      setError('Use ao menos 10 caracteres e combine três tipos: maiúsculas, minúsculas, números e símbolos.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setBusy(true)
    const result = await auth.updatePassword(password)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setDone(true)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo"><img className="brand-favicon" src="/dindin-10-logo.png" alt="DinDin 10!" /></div>
          <div><div className="brand-title">DinDin 10!</div><div className="brand-sub">Recuperação segura de senha</div></div>
        </div>

        <div style={{ marginTop: 22 }}>
          <h1 className="auth-title">{done ? 'Senha alterada' : 'Defina uma nova senha'}</h1>
          <div className="text-sm text-muted">{done ? 'Todas as sessões foram encerradas.' : 'Use uma senha forte para proteger sua conta.'}</div>
        </div>

        {error && <div className="notice danger" style={{ marginTop: 16 }} role="alert">{error}</div>}

        {done && <a className="btn btn-primary btn-block" style={{ marginTop: 18 }} href="/">Voltar para o login</a>}

        {!done && ready && (
          <form className="stack" style={{ gap: 14, marginTop: 18 }} onSubmit={submit}>
            <div className="field"><label className="label" htmlFor="reset-password">Nova senha</label><input id="reset-password" className="input" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            <div className="field"><label className="label" htmlFor="reset-confirm">Confirmar nova senha</label><input id="reset-confirm" className="input" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar nova senha'}</button>
          </form>
        )}

        {!done && busy && !ready && <div className="text-sm text-muted" style={{ marginTop: 18 }}>Validando o link de recuperação...</div>}
        {!done && !busy && !ready && <a className="btn btn-block" style={{ marginTop: 18 }} href="/">Voltar para o login</a>}
      </div>
    </div>
  )
}
