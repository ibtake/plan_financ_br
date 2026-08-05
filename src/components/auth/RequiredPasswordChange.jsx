import { useState } from 'react'
import { useAuth, validatePassword } from '../../contexts/AuthContext.jsx'
import { callAdminApi } from '../../lib/adminApi.js'

export default function RequiredPasswordChange() {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (password !== confirm) return setError('As senhas não coincidem.')
    if (!validatePassword(password).valid) {
      return setError('Use ao menos 10 caracteres e combine três tipos: maiúsculas, minúsculas, números e símbolos.')
    }
    setBusy(true)
    const result = await callAdminApi('complete-password-change', { password })
    setBusy(false)
    if (result.error) return setError(result.error)
    await auth.signOut('initial_password_changed')
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card stack" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-logo">🔑</div>
          <div><div className="brand-title">Defina sua senha</div><div className="brand-sub">A senha temporária só pode ser usada no primeiro acesso</div></div>
        </div>
        {error && <div className="notice danger" role="alert">{error}</div>}
        <div className="field"><label className="label" htmlFor="required-password">Nova senha</label><input id="required-password" className="input" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
        <div className="field"><label className="label" htmlFor="required-confirm">Confirmar nova senha</label><input id="required-confirm" className={`input${confirm && confirm !== password ? ' input-invalid' : ''}`} type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar nova senha'}</button>
      </form>
    </div>
  )
}