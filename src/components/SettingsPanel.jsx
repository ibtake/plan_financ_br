import { useRef, useState } from 'react'
import { AlertTriangle, Database, Download, FlaskConical, Moon, Palette, Sun, Upload } from 'lucide-react'
import { importJSON } from '../utils/exporters.js'
import AdminUserManagement from './AdminUserManagement.jsx'

export default function SettingsPanel({
  theme,
  transactionCount,
  categoryCount,
  goalCount,
  onToggleTheme,
  onExportJSON,
  onImport,
  onLoadSample,
  onClearAll,
}) {
  const inputRef = useRef(null)
  const [message, setMessage] = useState(null)

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const data = await importJSON(file)
      await onImport(data)
      setMessage({ tone: 'success', text: 'Backup importado com sucesso.' })
    } catch (error) {
      setMessage({ tone: 'danger', text: error.message })
    }
  }

  const loadSample = async () => {
    if (transactionCount && !window.confirm('Os dados atuais serão substituídos pelos dados de exemplo. Continuar?')) return
    await onLoadSample()
    setMessage({ tone: 'success', text: 'Dados de exemplo carregados.' })
  }

  const clear = async () => {
    if (!window.confirm('Apagar lançamentos, orçamentos, metas e restaurar as categorias padrão? Esta ação não pode ser desfeita.')) return
    await onClearAll()
    setMessage({ tone: 'success', text: 'Dados da conta removidos.' })
  }

  return (
    <div className="stack">
      {message && <div className={`notice ${message.tone}`}>{message.text}</div>}

      <AdminUserManagement />

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">
                <Palette size={18} strokeWidth={2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
                Aparência
              </div>
              <div className="card-sub">Personalize como o planejador é exibido</div>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>Tema {theme === 'dark' ? 'escuro' : 'claro'}</strong>
              <div className="text-sm text-muted">A preferência fica salva neste navegador.</div>
            </div>
            <button className="btn" onClick={onToggleTheme}>
              {theme === 'dark' ? (
                <>
                  <Sun size={16} strokeWidth={2} />
                  Usar tema claro
                </>
              ) : (
                <>
                  <Moon size={16} strokeWidth={2} />
                  Usar tema escuro
                </>
              )}
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">
                <Database size={18} strokeWidth={2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
                Seus dados
              </div>
              <div className="card-sub">Dados sincronizados com segurança na sua conta</div>
            </div>
          </div>
          <div className="stats-inline">
            <div><strong>{transactionCount}</strong><span>lançamentos</span></div>
            <div><strong>{categoryCount}</strong><span>categorias</span></div>
            <div><strong>{goalCount}</strong><span>metas</span></div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <Database size={18} strokeWidth={2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              Backup e restauração
            </div>
            <div className="card-sub">Exporte regularmente para não perder seu histórico</div>
          </div>
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={onExportJSON}>
            <Download size={16} strokeWidth={2} />
            Baixar backup JSON
          </button>
          <button className="btn" onClick={() => inputRef.current?.click()}>
            <Upload size={16} strokeWidth={2} />
            Importar backup
          </button>
          <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={handleFile} />
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          A importação substitui apenas os conjuntos presentes no arquivo. O formato JSON preserva recorrências, parcelas, categorias, orçamentos e metas.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <FlaskConical size={18} strokeWidth={2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              Dados de demonstração
            </div>
            <div className="card-sub">Explore gráficos e recursos sem cadastrar tudo manualmente</div>
          </div>
          <button className="btn" onClick={loadSample}>Carregar exemplo</button>
        </div>
      </section>

      <section className="card danger-zone">
        <div className="card-head">
          <div>
            <div className="card-title">
              <AlertTriangle size={18} strokeWidth={2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              Zona de perigo
            </div>
            <div className="card-sub">Limpe todos os dados financeiros da sua conta</div>
          </div>
          <button className="btn btn-danger" onClick={clear}>Apagar todos os dados</button>
        </div>
      </section>
    </div>
  )
}