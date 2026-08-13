import { useEffect, useState } from 'react'
import { useAuth, validatePassword } from '../../contexts/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'
import CodeInput from './CodeInput.jsx'

/**
 * Tela de redefinicao de senha.
 *
 * Fluxo com detectSessionInUrl=true:
 * 1. O Supabase client detecta o code na URL automaticamente e troca por sessao
 * 2. onAuthStateChange dispara SIGNED_IN com a sessao de recovery
 * 3. AuthContext atualiza session e user
 * 4. ResetPasswordScreen detecta que ja tem sessao valida e libera o formulario
 *
 * Fluxo de fallback manual:
 * 1. Se a sessao nao foi estabelecida automaticamente, tenta extrair o code
 *    manualmente de window.location.search (PKCE) ou window.location.hash (Implicit)
 * 2. Chama exchangeRecoveryCode manualmente
 * 3. Se falhar, exibe erro
 */
export default function ResetPasswordScreen() {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(true)
  const [ready, setReady] = useState(false)
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let settled = false

    // Limpa os parametros da URL para nao vazar o code
    if (window.location.search || window.location.hash) {
      window.history.replaceState({}, document.title, '/reset-password')
    }

    const tryManualExchange = async () => {
      // Fallback 1: PKCE code no query string (?code=xxx)
      let code = new URLSearchParams(window.location.search).get('code')

      // Fallback 2: hash fragment com access_token (Implicit flow)
      if (!code) {
        const hash = window.location.hash || ''
        const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
        code = hashParams.get('code')
        // Se achou no hash, o Supabase processou e redirecionou com hash
        if (!code) {
          const accessToken = hashParams.get('access_token')
          if (accessToken) {
            // Ja tem token no hash - o cliente Supabase pode ter processado
            // Vamos verificar sessao
            return null
          }
        }
      }

      if (!code) return null

      const result = await auth.exchangeRecoveryCode(code)
      return result
    }

    const settle = async () => {
      if (settled) return
      settled = true
      if (!active) return

      // 1. Verifica se a sessao ja foi estabelecida (auto-detected)
      const { data: currentSession } = await supabase.auth.getSession()
      if (active && currentSession?.session) {
        // Sessao estabelecida automaticamente pelo detectSessionInUrl
        setBusy(false)
        const factors = await auth.listFactors()
        if (active) {
          if (factors.length) setMfaRequired(true)
          else setReady(true)
        }
        return
      }

      // 2. Fallback: tentar extracao manual do code
      const result = await tryManualExchange()
      if (!active) return

      if (result && result.error) {
        setBusy(false)
        setError(result.error)
        return
      }

      if (result && result.data) {
        const factors = await auth.listFactors()
        if (!active) return
        setBusy(false)
        if (factors.length) setMfaRequired(true)
        else setReady(true)
        return
      }

      // 3. Nada encontrado - erro
      setBusy(false)
      setError('Link de recuperacao invalido ou expirado.')
    }

    // Aguarda o ciclo de deteccao automatica do Supabase client
    // O onAuthStateChange pode levar alguns ms para processar
    const timer = setTimeout(settle, 500)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [auth])

  const submitMfa = async (event) => {
    event.preventDefault()
    const code = mfaCode.replace(/\D/g, '').slice(0, 6)
    if (code.length !== 6) {
      setError('Digite os 6 digitos do codigo do autenticador.')
      return
    }
    setBusy(true)
    setError('')
    const result = await auth.verifyMfaChallenge(code)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setMfaCode('')
    setMfaRequired(false)
    setReady(true)
  }

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
      if (result.code === 'insufficient_aal') {
        setMfaRequired(true)
        setReady(false)
      }
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

        {!done && mfaRequired && (
          <form className="stack" style={{ gap: 14, marginTop: 18 }} onSubmit={submitMfa}>
            <div className="field"><label className="label">Codigo do autenticador</label><CodeInput value={mfaCode} onChange={setMfaCode} disabled={busy} /></div>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? 'Validando...' : 'Confirmar identidade'}</button>
          </form>
        )}

        {!done && ready && !mfaRequired && (
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