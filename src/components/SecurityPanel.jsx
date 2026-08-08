import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { EVENT_LABELS, fetchEvents } from '../lib/audit.js'
import CodeInput from './auth/CodeInput.jsx'

function EventList() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await fetchEvents(60)
    setEvents(data || [])
    setExpanded(false)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const failures = events.filter((event) =>
    ['critical', 'warning'].includes(event.severity) &&
    new Date(event.created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000,
  ).length
  const lastSuccessfulLogin = events.find((event) => event.event_type === 'login_success')
  const attentionEvents = events
    .filter((event) => ['critical', 'warning'].includes(event.severity))
    .slice(0, 4)
  const summaryEvents = [lastSuccessfulLogin, ...attentionEvents]
    .filter(Boolean)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const visibleEvents = expanded ? events : summaryEvents
  const hasMoreEvents = events.length > summaryEvents.length

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Histórico de segurança</div>
          <div className="card-sub">Eventos da sua conta dos últimos 7 dias, mais recentes primeiro</div>
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>Atualizar</button>
      </div>
      {failures >= 3 && (
        <div className="notice danger" style={{ marginBottom: 14 }}>
          Foram detectados {failures} eventos de atenção nas últimas 24 horas. Revise o
          histórico e altere sua senha se não reconhecer alguma atividade.
        </div>
      )}
      {loading ? <div className="empty">Carregando histórico...</div> : events.length === 0 ? (
        <div className="empty">Nenhum evento registrado ainda.</div>
      ) : (
        <>
        <div className="security-events">
          {visibleEvents.map((event) => {
            const label = EVENT_LABELS[event.event_type] || { icon: '•', text: event.event_type }
            return (
              <div className={`security-event ${event.severity}`} key={event.id}>
                <span className="security-event-icon" aria-hidden="true">{label.icon}</span>
                <div className="grow">
                  <strong>{label.text}</strong>
                  <div className="text-xs text-muted">
                    {new Date(event.created_at).toLocaleString('pt-BR')}
                  </div>
                </div>
                <span className={`chip ${event.severity === 'critical' ? 'expense' : event.severity === 'warning' ? 'warning' : 'info'}`}>
                  {event.severity === 'critical' ? 'Crítico' : event.severity === 'warning' ? 'Atenção' : 'Informação'}
                </span>
              </div>
            )
          })}
        </div>
        {hasMoreEvents && (
          <div className="settings-actions" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? 'Mostrar menos' : 'Mais detalhes'}
            </button>
          </div>
        )}
        </>
      )}
    </section>
  )
}

export default function SecurityPanel() {
  const auth = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const refresh = useCallback(async () => {
    const factors = await auth.listFactors()
    setEnabled(factors.length > 0)
  }, [auth])

  useEffect(() => { refresh() }, [refresh])

  const begin = async () => {
    setBusy(true); setMessage(null)
    const result = await auth.enrollMfa()
    setBusy(false)
    if (result.error) setMessage({ tone: 'danger', text: result.error })
    else { setSetup(result); setCode('') }
  }

  const confirm = async () => {
    setBusy(true); setMessage(null)
    const result = await auth.verifyMfaEnrollment(setup.factorId, code)
    setBusy(false)
    if (result.error) setMessage({ tone: 'danger', text: result.error })
    else {
      setSetup(null); setCode(''); setEnabled(true)
      setMessage({ tone: 'success', text: 'Verificação em duas etapas ativada.' })
    }
  }

  const disable = async () => {
    if (!window.confirm('Desativar a verificação em duas etapas reduz a segurança da conta. Continuar?')) return
    setBusy(true); setMessage(null)
    const result = await auth.disableMfa(disableCode)
    setBusy(false)
    if (result.error) setMessage({ tone: 'danger', text: result.error })
    else {
      setDisableCode(''); setEnabled(false)
      setMessage({ tone: 'success', text: 'Verificação em duas etapas desativada.' })
    }
  }

  return (
    <div className="stack">
      {message && <div className={`notice ${message.tone}`}>{message.text}</div>}
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Verificação em duas etapas (MFA)</div>
            <div className="card-sub">Compatível com Google Authenticator, Authy e 1Password</div>
          </div>
          <span className={`chip ${enabled ? 'income' : 'warning'}`}>
            {enabled ? 'Proteção ativa' : 'Proteção desativada'}
          </span>
        </div>

        {!enabled && !setup && (
          <div className="setting-row">
            <div className="text-sm text-soft">
              Além da senha, cada login exigirá um código temporário gerado no seu celular.
            </div>
            <button className="btn btn-primary" onClick={begin} disabled={busy}>
              {busy ? 'Preparando...' : 'Ativar MFA'}
            </button>
          </div>
        )}

        {setup && (
          <div className="mfa-setup">
            <div className="notice info">
              Escaneie o QR code no aplicativo autenticador. Depois digite o código atual
              para confirmar. Não compartilhe o QR code nem a chave manual.
            </div>
            <img className="mfa-qr" src={setup.qrCode} alt="QR code para configurar o aplicativo autenticador" />
            <details className="text-sm">
              <summary>Não consigo escanear o QR code</summary>
              <p>Digite esta chave manualmente no aplicativo:</p>
              <code className="mfa-secret">{setup.secret}</code>
            </details>
            <CodeInput value={code} onChange={setCode} disabled={busy} />
            <div className="settings-actions">
              <button className="btn btn-primary" onClick={confirm} disabled={busy || code.length !== 6}>
                {busy ? 'Verificando...' : 'Confirmar ativação'}
              </button>
              <button className="btn" onClick={() => setSetup(null)} disabled={busy}>Cancelar</button>
            </div>
          </div>
        )}

        {enabled && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="notice success">Sua conta exige um código temporário após a senha.</div>
            <div className="field" style={{ maxWidth: 420 }}>
              <label className="label">Código atual para desativar</label>
              <CodeInput value={disableCode} onChange={setDisableCode} disabled={busy} autoFocus={false} />
            </div>
            <div><button className="btn btn-danger" onClick={disable} disabled={busy || disableCode.length !== 6}>Desativar MFA</button></div>
          </div>
        )}
      </section>
      <EventList />
    </div>
  )
}
