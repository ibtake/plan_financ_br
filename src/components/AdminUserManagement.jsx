import { useCallback, useEffect, useState } from 'react'
import { useAuth, validatePassword } from '../contexts/AuthContext.jsx'
import { callAdminApi } from '../lib/adminApi.js'
import CodeInput from './auth/CodeInput.jsx'

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?'
  const required = ['A', 'a', '7', '!']
  const limit = Math.floor((2 ** 32) / alphabet.length) * alphabet.length
  const random = []
  while (random.length < 14) {
    const bytes = crypto.getRandomValues(new Uint32Array(14 - random.length))
    for (const value of bytes) {
      if (value < limit) random.push(alphabet[value % alphabet.length])
      if (random.length === 14) break
    }
  }
  return [...required, ...random]
    .map((character) => ({ character, order: crypto.getRandomValues(new Uint32Array(1))[0] }))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.character)
    .join('')
}

export default function AdminUserManagement() {
  const auth = useAuth()
  const [status, setStatus] = useState('checking')
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [code, setCode] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [metrics, setMetrics] = useState([])

  const loadUsers = useCallback(async () => {
    const result = await callAdminApi('list-users')
    if (result.error) {
      setMessage({ tone: 'danger', text: result.error })
      return
    }
    setUsers(result.data?.users || [])
  }, [])

  const loadMetrics = useCallback(async () => {
    const result = await callAdminApi('widget-metrics')
    if (!result.error) setMetrics(result.data?.metrics || [])
  }, [])

  useEffect(() => {
    let active = true
    callAdminApi('status').then(async (result) => {
      if (!active) return
      if (result.error || !result.data?.admin) return setStatus('hidden')
      if (result.data.aal !== 'aal2') return setStatus('needs-mfa')
      setStatus('ready')
      await Promise.all([loadUsers(), loadMetrics()])
    })
    return () => { active = false }
  }, [loadMetrics, loadUsers])

  if (status === 'checking' || status === 'hidden') return null

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const generate = () => setForm((current) => ({ ...current, password: generateTemporaryPassword() }))

  const createUser = async (event) => {
    event.preventDefault()
    setMessage(null)
    if (!validatePassword(form.password).valid) {
      return setMessage({ tone: 'danger', text: 'A senha temporária não atende à política de segurança.' })
    }
    if (code.length !== 6) {
      return setMessage({ tone: 'danger', text: 'Informe o código MFA atual para autorizar a criação.' })
    }

    setBusy(true)
    const verified = await auth.verifyMfaChallenge(code)
    if (verified.error) {
      setBusy(false)
      setCode('')
      return setMessage({ tone: 'danger', text: verified.error })
    }

    const result = await callAdminApi('create-user', form)
    setBusy(false)
    setCode('')
    if (result.error) return setMessage({ tone: 'danger', text: result.error })

    setUsers((current) => [...current, result.data.user].sort((a, b) => a.email.localeCompare(b.email, 'pt-BR')))
    setForm({ fullName: '', email: '', password: '' })
    setMessage({ tone: 'success', text: 'Usuário criado. Entregue a senha temporária por um canal seguro.' })
  }

  return (
    <section className="card admin-users">
      <div className="card-head">
        <div>
          <div className="card-title">Administração de usuários</div>
          <div className="card-sub">Contas autorizadas a acessar o planejador</div>
        </div>
      </div>

      {status === 'needs-mfa' ? (
        <div className="notice warning">Ative a verificação em duas etapas na aba Segurança e entre novamente para administrar usuários.</div>
      ) : (
        <div className="admin-users-grid">
          <form className="stack" onSubmit={createUser}>
            <h3 className="panel-heading">Novo usuário</h3>
            {message && <div className={`notice ${message.tone}`} role="status">{message.text}</div>}
            <div className="field"><label className="label" htmlFor="admin-full-name">Nome</label><input id="admin-full-name" className="input" value={form.fullName} onChange={set('fullName')} maxLength={120} autoComplete="off" required /></div>
            <div className="field"><label className="label" htmlFor="admin-email">E-mail</label><input id="admin-email" className="input" type="email" value={form.email} onChange={set('email')} maxLength={254} autoComplete="off" required /></div>
            <div className="field">
              <label className="label" htmlFor="admin-password">Senha temporária</label>
              <div className="input-action-row"><input id="admin-password" className="input" type="password" value={form.password} onChange={set('password')} minLength={10} maxLength={128} autoComplete="new-password" required /><button className="btn" type="button" onClick={generate}>Gerar</button></div>
            </div>
            <div className="field"><label className="label">Confirmação MFA</label><CodeInput value={code} onChange={setCode} disabled={busy} /></div>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Criando...' : 'Criar usuário'}</button>
          </form>

          <div className="admin-user-list">
            <h3 className="panel-heading">Usuários ({users.length})</h3>
            {users.map((item) => (
              <div className="admin-user-row" key={item.id}>
                <div><strong>{item.fullName || 'Sem nome'}</strong><span>{item.email}</span></div>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('pt-BR')}</time>
              </div>
            ))}
          </div>
        </div>
      )}
      {status === 'ready' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <div>
              <div className="card-title">Falhas de autenticação do widget</div>
              <div className="card-sub">Últimos 7 dias · métricas amostradas em 10%</div>
            </div>
            <button className="btn btn-sm" type="button" onClick={loadMetrics}>Atualizar</button>
          </div>
          {metrics.length === 0 ? <div className="empty">Nenhuma falha amostrada.</div> : (
            <div className="stack">
              {metrics.map((item) => (
                <div className="setting-row" key={`${item.metric_date}-${item.failure_type}`}>
                  <strong>{item.metric_date} · {item.failure_type}</strong>
                  <span className="chip warning">{item.sampled_count} amostras</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
