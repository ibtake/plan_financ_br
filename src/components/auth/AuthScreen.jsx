// =====================================================================
// Tela de autenticacao: login, recuperacao e desafio MFA
// =====================================================================

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { configurationProblem } from '../../lib/supabase.js'
import CodeInput from './CodeInput.jsx'
import TurnstileCaptcha, { isTurnstileConfigured } from './TurnstileCaptcha.jsx'

export default function AuthScreen() {
  const auth = useAuth()
  // login | forgot | mfa
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({
    email: '',
    password: '',
  })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [captchaToken, setCaptchaToken] = useState(null)

  const missingConfig = useMemo(() => configurationProblem(), [])
  const captchaEnabled = isTurnstileConfigured()

  useEffect(() => {
    if (auth.mfaStage === 'required') setMode('mfa')
  }, [auth.mfaStage])

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const resetMessages = () => {
    setError('')
    setNotice('')
  }

  const switchMode = (next) => {
    resetMessages()
    setCode('')
    setCaptchaToken(null)
    setMode(next)
  }

  // ---------- Configuracao ausente ----------

  if (missingConfig) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-logo">
              <img className="brand-favicon" src="/favicon.png" alt="Planejador Financeiro" />
            </div>
            <div>
              <div className="brand-title">Planejador Financeiro</div>
              <div className="brand-sub">Configuração pendente</div>
            </div>
          </div>

          <div className="notice danger" style={{ marginTop: 16 }}>
            <strong>Conexão com o banco de dados não configurada.</strong>
            <p style={{ margin: '8px 0 0' }}>
              As seguintes variáveis de ambiente estão ausentes ou ainda contêm o valor de
              exemplo:
            </p>
            <ul style={{ margin: '8px 0 0 18px' }}>
              {missingConfig.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </div>

          <div className="stack" style={{ gap: 10, marginTop: 16 }}>
            <div className="text-sm text-soft">
              <strong>Para resolver localmente:</strong> copie o arquivo{' '}
              <code>.env.example</code> para <code>.env</code> e preencha os dois valores com os
              dados do seu projeto Supabase.
            </div>
            <div className="text-sm text-soft">
              <strong>Na Vercel:</strong> cadastre as duas variáveis em Settings {'>'}{' '}
              Environment Variables e faça um novo deploy.
            </div>
            <div className="text-sm text-muted">
              O passo a passo completo está no manual de implantação (PDF) incluído no projeto.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---------- Acoes ----------

  const handleLogin = async (event) => {
    event.preventDefault()
    resetMessages()
    if (captchaEnabled && !captchaToken) {
      setError('Conclua a verificação anti-bot antes de entrar.')
      return
    }
    setBusy(true)
    const result = await auth.signIn({ email: form.email, password: form.password, captchaToken })
    setBusy(false)

    if (result.error) {
      setError(result.error)
      return
    }
    if (result.mfaRequired) {
      setMode('mfa')
      setCode('')
    }
    // Sem MFA, o AuthContext atualiza a sessao e o App troca de tela
  }

  const handleForgot = async (event) => {
    event.preventDefault()
    resetMessages()
    if (captchaEnabled && !captchaToken) {
      setError('Conclua a verificação anti-bot antes de solicitar a recuperação.')
      return
    }
    setBusy(true)
    const result = await auth.resetPassword(form.email, captchaToken)
    setBusy(false)

    if (result.error) {
      setError(result.error)
      return
    }
    // Mensagem neutra: nao revela se o e-mail existe na base
    setNotice(
      'Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha em ' +
        'alguns minutos. Verifique também a caixa de spam.',
    )
  }

  const handleMfa = async (event) => {
    event.preventDefault()
    resetMessages()

    if (code.length !== 6) {
      setError('Digite os 6 dígitos do código.')
      return
    }

    setBusy(true)
    const result = await auth.verifyMfaChallenge(code)
    setBusy(false)

    if (result.error) {
      setError(result.error)
      setCode('')
    }
  }

  const cancelMfa = async () => {
    await auth.signOut('mfa_cancelled')
    switchMode('login')
  }

  // ---------- Formularios ----------

  const titles = {
    login: { title: 'Entrar na sua conta', sub: 'Acesse seu planejamento financeiro' },
    forgot: { title: 'Recuperar senha', sub: 'Enviaremos um link por e-mail' },
    mfa: { title: 'Verificação em duas etapas', sub: 'Abra seu aplicativo autenticador' },
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo">
            <img className="brand-favicon" src="/favicon.png" alt="Planejador Financeiro" />
          </div>
          <div>
            <div className="brand-title">Planejador Financeiro</div>
            <div className="brand-sub">Suas finanças sob controle</div>
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <h1 className="auth-title">{titles[mode].title}</h1>
          <div className="text-sm text-muted">{titles[mode].sub}</div>
        </div>

        {error && (
          <div className="notice danger" style={{ marginTop: 16 }} role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice success" style={{ marginTop: 16 }} role="status">
            {notice}
          </div>
        )}

        {/* ----- Login ----- */}
        {mode === 'login' && (
          <form className="stack" style={{ gap: 14, marginTop: 18 }} onSubmit={handleLogin}>
            <div className="field">
              <label className="label" htmlFor="login-email">
                E-mail
              </label>
              <input
                id="login-email"
                className="input"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={form.email}
                onChange={set('email')}
                placeholder="voce@exemplo.com"
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="login-password">
                Senha
              </label>
              <input
                id="login-password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={set('password')}
                placeholder="••••••••••"
              />
            </div>

            <TurnstileCaptcha onTokenChange={setCaptchaToken} />

            <button className="btn btn-primary btn-block" type="submit" disabled={busy || (captchaEnabled && !captchaToken)}>
              {busy ? 'Entrando...' : 'Entrar'}
            </button>

            <div className="auth-links">
              <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
                Esqueci minha senha
              </button>
            </div>
            <p className="text-xs text-muted" style={{ margin: 0 }}>
              Novas contas são criadas exclusivamente pelo administrador do sistema.
            </p>
          </form>
        )}

        {/* ----- Recuperacao ----- */}
        {mode === 'forgot' && (
          <form className="stack" style={{ gap: 14, marginTop: 18 }} onSubmit={handleForgot}>
            <div className="field">
              <label className="label" htmlFor="forgot-email">
                E-mail da conta
              </label>
              <input
                id="forgot-email"
                className="input"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={form.email}
                onChange={set('email')}
                placeholder="voce@exemplo.com"
              />
            </div>

            <TurnstileCaptcha onTokenChange={setCaptchaToken} />

            <button className="btn btn-primary btn-block" type="submit" disabled={busy || (captchaEnabled && !captchaToken)}>
              {busy ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>

            <div className="auth-links">
              <button type="button" className="link-btn" onClick={() => switchMode('login')}>
                Voltar para o login
              </button>
            </div>
          </form>
        )}

        {/* ----- Desafio MFA ----- */}
        {mode === 'mfa' && (
          <form className="stack" style={{ gap: 16, marginTop: 18 }} onSubmit={handleMfa}>
            <div className="notice info">
              Digite o código de 6 dígitos exibido no seu aplicativo autenticador.
            </div>

            <CodeInput value={code} onChange={setCode} disabled={busy} />

            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={busy || code.length !== 6}
            >
              {busy ? 'Verificando...' : 'Verificar e entrar'}
            </button>

            <div className="auth-links">
              <button type="button" className="link-btn" onClick={cancelMfa}>
                Cancelar e sair
              </button>
            </div>

            <p className="text-xs text-muted" style={{ margin: 0 }}>
              O código muda a cada 30 segundos. Se falhar, aguarde o próximo código e tente
              novamente.
            </p>
          </form>
        )}
      </div>

      <p className="auth-foot text-xs text-muted">
        Seus dados são protegidos por políticas de acesso no banco de dados. Cada conta
        enxerga exclusivamente os próprios lançamentos.
      </p>
    </div>
  )
}
