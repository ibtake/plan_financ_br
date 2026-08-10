import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Database, Download, FlaskConical, Moon, Palette, SlidersHorizontal, Smartphone, Sun, Upload } from 'lucide-react'
import { importJSON } from '../utils/exporters.js'
import { normalizeTransactionFormFields } from '../utils/transactionFormFields.js'
import { createWidgetSetup, revokeWidget } from '../lib/widgetApi.js'
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
  reverseGoalRetentionMonths,
  reverseGoalRetentionLoaded,
  onSetReverseGoalRetention,
  transactionFormFields,
  onTransactionFormFieldsChange,
}) {
  const inputRef = useRef(null)
  const [message, setMessage] = useState(null)
  const [retentionMonths, setRetentionMonths] = useState(reverseGoalRetentionMonths ?? '')
  const [savingRetention, setSavingRetention] = useState(false)
  const [settingUpWidget, setSettingUpWidget] = useState(false)
  const [revokingWidget, setRevokingWidget] = useState(false)

  // A configuracao vem junto dos dados auxiliares. Enquanto ela nao chegou,
  // o select fica bloqueado para nao gravar acidentalmente "Nunca excluir".
  useEffect(() => {
    if (reverseGoalRetentionLoaded) setRetentionMonths(reverseGoalRetentionMonths ?? '')
  }, [reverseGoalRetentionLoaded, reverseGoalRetentionMonths])
  const visibleTransactionFields = normalizeTransactionFormFields(transactionFormFields)
  const transactionFields = [
    ['method', 'Forma de pagamento'],
    ['recurrence', 'Repetição'],
    ['installments', 'Parcelas'],
    ['tags', 'Tags'],
    ['note', 'Observação'],
    ['paid', 'Status pago/recebido'],
  ]

  const applyRetention = async () => {
    const normalized = retentionMonths === '' ? null : Number(retentionMonths)
    if (normalized !== null && (!Number.isInteger(normalized) || normalized < 1 || normalized > 12)) {
      setMessage({ tone: 'danger', text: 'Escolha de 1 a 12 meses ou deixe o campo vazio.' })
      return
    }
    const description = normalized === null ? 'Nunca excluir metas reversas concluídas?' : `Excluir permanentemente metas reversas concluídas após ${normalized} mês(es)?`
    if (!window.confirm(`${description} Metas em andamento e metas comuns nunca serão excluídas.`)) return
    setSavingRetention(true)
    const saved = await onSetReverseGoalRetention(normalized)
    setSavingRetention(false)
    if (saved) setMessage({ tone: 'success', text: normalized === null ? 'Retenção desativada: metas concluídas não serão excluídas automaticamente.' : 'Configuração de retenção aplicada.' })
  }

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

  const setupWidget = async () => {
    setSettingUpWidget(true)
    try {
      const script = await createWidgetSetup()
      await navigator.clipboard.writeText(script)
      window.location.href = 'scriptable:///add'
      setMessage({ tone: 'success', text: 'Script copiado. No Scriptable, cole o conteúdo, salve e execute uma vez.' })
    } catch (error) {
      setMessage({ tone: 'danger', text: error.message })
    } finally {
      setSettingUpWidget(false)
    }
  }

  const disableWidget = async () => {
    if (!window.confirm('Revogar o acesso de todos os widgets Scriptable desta conta?')) return
    setRevokingWidget(true)
    try {
      await revokeWidget()
      setMessage({ tone: 'success', text: 'Acesso do widget revogado. O Scriptable deixará de receber dados.' })
    } catch (error) {
      setMessage({ tone: 'danger', text: error.message })
    } finally {
      setRevokingWidget(false)
    }
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
              <SlidersHorizontal size={18} strokeWidth={2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              Campos do lançamento
            </div>
            <div className="card-sub">Escolha os campos opcionais exibidos ao criar um lançamento</div>
          </div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          {transactionFields.map(([key, label]) => (
            <label className="checkbox" key={key}>
              <input
                type="checkbox"
                checked={visibleTransactionFields[key]}
                onChange={(event) => onTransactionFormFieldsChange({ ...visibleTransactionFields, [key]: event.target.checked })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Descrição, valor, data, categoria e tipo são obrigatórios e continuam sempre visíveis. As preferências ficam salvas apenas na sua conta.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <Smartphone size={18} strokeWidth={2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              Widget do iPhone
            </div>
            <div className="card-sub">Veja as contas que vencem hoje no Scriptable</div>
          </div>
        </div>
        <button className="btn btn-primary" onClick={setupWidget} disabled={settingUpWidget}>
          <Smartphone size={16} strokeWidth={2} />
          {settingUpWidget ? 'Preparando...' : 'Configurar no Scriptable'}
        </button>
        <button className="btn" onClick={disableWidget} disabled={revokingWidget} style={{ marginLeft: 8 }}>
          {revokingWidget ? 'Revogando...' : 'Revogar acesso'}
        </button>
        <p className="hint" style={{ marginTop: 12 }}>
          O botão prepara um código temporário, copia o script e abre o Scriptable. Lá, cole, salve e execute o script uma vez; depois adicione o widget à tela do iPhone.
        </p>
      </section>

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
            <div className="card-title">Metas Reversas</div>
            <div className="card-sub">Retenção de Metas Reversas concluídas</div>
          </div>
        </div>
        <div className="setting-row" style={{ alignItems: 'flex-end', gap: 16 }}>
          <div className="field grow">
            <label className="label">Excluir metas concluídas após</label>
            <select className="input" value={retentionMonths} onChange={(event) => setRetentionMonths(event.target.value)} disabled={!reverseGoalRetentionLoaded || savingRetention}>
              <option value="">Nunca excluir</option>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((months) => <option key={months} value={months}>{months} {months === 1 ? 'mês' : 'meses'}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={applyRetention} disabled={!reverseGoalRetentionLoaded || savingRetention}>{savingRetention ? 'Aplicando...' : 'Aplicar configuração'}</button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>Quando ativada, esta opção removerá permanentemente do banco de dados as Metas Reversas concluídas após o período definido. Metas em andamento nunca serão excluídas.</p>
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
