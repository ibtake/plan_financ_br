import { useEffect, useRef, useState } from 'react'
import { useAuth, validatePassword } from '../../contexts/AuthContext.jsx'
import { recoveryCode } from '../../lib/recoveryCode.js'
import CodeInput from './CodeInput.jsx'

/**
 * Tela de redefinicao de senha.
 *
 * Estrategia em tres camadas:
 *   1. O code/access_token da URL e capturado em recoveryCode.js no
 *      momento da importacao do modulo, ANTES que qualquer componente
 *      React monte ou que o Supabase client remova os parametros da URL.
 *   2. Aguarda auth.loading = false (AuthContext terminou init).
 *   3. Se auth.session existir, o auto-detect (detectSessionInUrl) funcionou
 *      e o Supabase client ja trocou o code por uma sessao.
 *      Senao, tenta a troca manual com o recoveryCode salvo em modulo.
 *      Se nada funcionar, mostra erro.
 *
 * Isso e resiliente a:
 *   - React StrictMode (que monta/desmonta duas vezes)
 *   - Email clients que corrompem o redirect_to (o code ainda chega na URL)
 *   - Race condition entre ordem dos effects (AuthProvider executa antes)
 *   - Supabase client removendo ?code=xxx da URL durante getSession()
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

  // --- EFEITO: processa o fluxo de recuperacao ---
  const settled = useRef(false)

  useEffect(() => {
    let active = true

    const settle = async () => {
      if (!active) return
      if (settled.current) return
      if (!auth.loading) settled.current = true
      if (!active) return

      // Remove o code/access_token da URL imediatamente, em qualquer caminho
      // (sucesso ou erro). O valor ja foi capturado no modulo recoveryCode.js,
      // entao esta limpeza precoce nao quebra a troca manual (CAMADA 2).
      if (window.location.search || window.location.hash) {
        window.history.replaceState({}, document.title, '/reset-password')
      }

      // Aguarda a inicializacao do AuthContext
      if (auth.loading) return

      // CAMADA 1: auto-detect funcionou (detectSessionInUrl)
      if (auth.session) {
        setBusy(false)
        const factors = await auth.listFactors()
        if (!active) return
        if (factors.length) setMfaRequired(true)
        else setReady(true)
        // Limpa a URL apos sucesso
        if (window.location.search || window.location.hash) {
          window.history.replaceState({}, document.title, '/reset-password')
        }
        return
      }

      // CAMADA 2: troca manual com o code salvo no modulo
      // (capturado antes que o Supabase client removesse da URL)
      if (recoveryCode) {
        const result = await auth.exchangeRecoveryCode(recoveryCode)
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
          // Limpa a URL apos sucesso
          if (window.location.search || window.location.hash) {
            window.history.replaceState({}, document.title, '/reset-password')
          }
          return
        }
      }

      // CAMADA 3: nada funcionou
      setBusy(false)
      setError('Link de recuperacao invalido ou expirado.')
    }

    settle()

    return () => {
      active = false
    }
  }, [auth, auth.loading])
  // Depende de auth e auth.loading para garantir que re-executa
  // quando loading muda (primitivo) e quando auth muda (objeto).
  // O eslint-disable que ficava nesta linha saiu no B36: com o linter
  // instalado, ele mesmo reportou que a diretiva nao suprimia nada.

  // Auto-submit do codigo MFA quando atinge 6 digitos (colagem ou autofill)
  // Mesmo comportamento do AuthScreen.jsx
  const submittedMfaCode = useRef(null)

  const submitMfaCode = async (value) => {
    const normalizedCode = String(value || '').replace(/\D/g, '').slice(0, 6)
    if (normalizedCode.length !== 6) return
    if (submittedMfaCode.current === normalizedCode) return
    submittedMfaCode.current = normalizedCode
    setBusy(true)
    setError('')
    const result = await auth.verifyMfaChallenge(normalizedCode)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      setMfaCode('')
      submittedMfaCode.current = null
      return
    }
    setMfaCode('')
    setMfaRequired(false)
    setReady(true)
  }

  useEffect(() => {
    if (mfaRequired && mfaCode.length === 6 && !busy) {
      void submitMfaCode(mfaCode)
    }
  }, [mfaRequired, mfaCode, busy])

  const submitMfa = async (event) => {
    event.preventDefault()
    await submitMfaCode(mfaCode)
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

        {error && <div id="reset-error" className="notice danger" style={{ marginTop: 16 }} role="alert">{error}</div>}

        {done && <a className="btn btn-primary btn-block" style={{ marginTop: 18 }} href="/">Voltar para o login</a>}

        {!done && mfaRequired && (
          <form className="stack" style={{ gap: 14, marginTop: 18 }} onSubmit={submitMfa}>
            <div className="field"><label className="label">Codigo do autenticador</label><CodeInput value={mfaCode} onChange={setMfaCode} disabled={busy} errorId={error ? 'reset-error' : undefined} /></div>
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