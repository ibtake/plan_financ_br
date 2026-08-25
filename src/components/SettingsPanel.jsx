import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Database, Download, FlaskConical, Moon, Palette, SlidersHorizontal, Smartphone, Sun, Upload } from 'lucide-react'
import { importJSON } from '../utils/exporters.js'
import { normalizeTransactionFormFields } from '../utils/transactionFormFields.js'
import { createWidgetSetup, getWidgetStatus, revokeWidget } from '../lib/widgetApi.js'
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
  const [widgetTokens, setWidgetTokens] = useState([])
  const [loadingWidgetStatus, setLoadingWidgetStatus] = useState(true)
  const [widgetError, setWidgetError] = useState(false)

  // A configuracao vem junto dos dados auxiliares. Enquanto ela nao chegou,
  // o select fica bloqueado para nao gravar acidentalmente "Nunca excluir".
  useEffect(() => {
    if (reverseGoalRetentionLoaded) setRetentionMonths(reverseGoalRetentionMonths ?? '')
  }, [reverseGoalRetentionLoaded, reverseGoalRetentionMonths])

  useEffect(() => {
    let active = true
    setWidgetError(false)
    getWidgetStatus()
      .then((tokens) => { if (active) setWidgetTokens(tokens) })
      .catch(() => { if (active) setWidgetError(true) })
      .finally(() => { if (active) setLoadingWidgetStatus(false) })
    return () => { active = false }
  }, [])
  const visibleTransactionFields = normalizeTransactionFormFields(transactionFormFields)
  const transactionFields = [
    ['method', 'Forma de pagamento'],
    ['recurrence', 'Repetição'],
    ['installments', 'Parcelas'],
    ['tags', 'Tags'],
    ['note', 'Observação'],
    ['paid', 'Status pago/recebido'],
  ]

  // Sucesso so pode aparecer se a operacao concluiu de fato. Os dois caminhos de
  // falha sao distintos: importData e clearAll sinalizam erro por retorno `false`
  // (nao lancam, porque ja reportaram no estado do hook), e o catch cobre o
  // oposto - uma rejeicao vinda da recarga posterior, fora do try daquelas.
  const runAction = async (action, successText, errorText) => {
    try {
      const ok = await action()
      setMessage(ok === false ? { tone: 'danger', text: errorText } : { tone: 'success', text: successText })
    } catch (error) {
      setMessage({ tone: 'danger', text: error.message })
    }
  }

  const applyRetention = async () => {
    const normalized = retentionMonths === '' ? null : Number(retentionMonths)
    // Inalcancavel pelo <select> atual, que so produz '' ou 1..12. Fica como
    // barreira caso o controle volte a ser campo livre.
    if (normalized !== null && (!Number.isInteger(normalized) || normalized < 1 || normalized > 12)) {
      setMessage({ tone: 'danger', text: 'Escolha de 1 a 12 meses ou deixe o campo vazio.' })
      return
    }
    const description = normalized === null ? 'Nunca excluir metas reversas concluídas?' : `Excluir permanentemente metas reversas concluídas após ${normalized} mês(es)?`
    if (!window.confirm(`${description} Metas em andamento e metas comuns nunca serão excluídas.`)) return
    // O par savingRetention fica fora do runAction, que nunca rejeita - tem catch
    // proprio -, e por isso o setSavingRetention(false) abaixo sempre roda.
    setSavingRetention(true)
    await runAction(
      () => onSetReverseGoalRetention(normalized),
      normalized === null
        ? 'Retenção desativada: metas concluídas não serão excluídas automaticamente.'
        : 'Configuração de retenção aplicada.',
      // "Nada foi alterado" e exato: setReverseGoalRetention so devolve false
      // quando a RPC set_reverse_goal_retention falha, e nada foi gravado ali.
      'Não foi possível aplicar a configuração de retenção. Nada foi alterado.',
    )
    setSavingRetention(false)
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    // A leitura entra na propria acao: importJSON lanca com mensagem pronta para
    // a tela, e o catch de runAction ja a exibe.
    await runAction(
      async () => onImport(await importJSON(file)),
      'Backup importado com sucesso.',
      'Não foi possível importar o backup. Nenhum dado foi alterado.',
    )
  }

  const loadSample = async () => {
    // Confirmacao incondicional: `transactionCount` sozinho liberava sem aviso a
    // conta com 0 lancamentos e metas/orcamentos preenchidos, e somar `categoryCount`
    // nao resolveria - o trigger handle_new_user semeia as categorias padrao em toda
    // conta, entao a condicao seria sempre verdadeira. Categorias personalizadas e
    // planos PGBL nao entram na troca: importData mantem os atuais. A excecao e o
    // B64 - buildSampleData recria a categoria padrao que o exemplo usa e o usuario
    // excluiu, senao os lancamentos entram orfaos (nao ha FK em category_id).
    if (!window.confirm('Lançamentos, orçamentos e metas serão substituídos pelos dados de exemplo. Suas categorias e os planos do Aporte Certo são preservados; categorias padrão que você excluiu e que o exemplo usa serão recriadas. Continuar?')) return
    await runAction(
      onLoadSample,
      'Dados de exemplo carregados.',
      'Não foi possível carregar os dados de exemplo. Nenhum dado foi alterado.',
    )
  }

  const clear = async () => {
    if (!window.confirm('Apagar lançamentos, orçamentos, metas e restaurar as categorias padrão? Esta ação não pode ser desfeita.')) return
    await runAction(
      onClearAll,
      'Dados da conta removidos.',
      'Não foi possível remover os dados. Nada foi apagado.',
    )
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
      setWidgetTokens((tokens) => tokens.map((token) => ({ ...token, revoked_at: new Date().toISOString() })))
      setMessage({ tone: 'success', text: 'Acesso do widget revogado. O Scriptable deixará de receber dados.' })
    } catch (error) {
      setMessage({ tone: 'danger', text: error.message })
    } finally {
      setRevokingWidget(false)
    }
  }

  return (
    <div className="stack">
      {message && <div className={`notice ${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>{message.text}</div>}

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
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={setupWidget} disabled={settingUpWidget}>
            <Smartphone size={16} strokeWidth={2} />
            {settingUpWidget ? 'Preparando...' : 'Configurar no Scriptable'}
          </button>
          <button className="btn btn-danger" onClick={disableWidget} disabled={revokingWidget}>
            {revokingWidget ? 'Revogando...' : 'Revogar todos os acessos'}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          {loadingWidgetStatus ? 'Consultando integrações...' : widgetError ? 'Não foi possível consultar as integrações. Tente novamente.' : `${widgetTokens.filter((token) => !token.revoked_at).length} integração(ões) ativa(s).`}
          {' '}Os valores dos tokens não são exibidos nem recuperáveis; apenas o status pode ser consultado. O botão vermelho revoga todos os widgets desta conta.
        </p>
        {!loadingWidgetStatus && widgetTokens.length > 0 && (
          <div className="text-sm text-muted" style={{ marginTop: 8 }}>
            {widgetTokens.map((token, index) => (
              <div key={token.id}>
                Widget {index + 1} · {String(token.id).slice(0, 8)} · {token.revoked_at ? 'revogado' : 'ativo'}
              </div>
            ))}
          </div>
        )}
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
        {/* O select e o botao ficam desabilitados enquanto a configuracao atual
            nao chegou. Sem esta linha, uma falha de leitura deixava o painel morto
            e sem explicacao. Desde o B77 e apenas a leitura da PROPRIA retencao: o
            supportingDataRequest de useSupabaseFinance.js aplica cada uma das cinco
            leituras de apoio separadamente, e antes qualquer delas derrubava este
            painel. A frase serve aos dois estados de proposito: `loading` vira
            false antes do pacote de apoio resolver, entao nao ha como distinguir
            "carregando" de "falhou" sem um estado novo - e a providencia do usuario
            e a mesma. */}
        {!reverseGoalRetentionLoaded && <p className="hint" style={{ marginTop: 12 }}>A configuração atual ainda não foi lida. Se esta mensagem persistir, recarregue a página.</p>}
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
