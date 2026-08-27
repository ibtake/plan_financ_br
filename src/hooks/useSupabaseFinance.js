import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase, translateAuthError } from '../lib/supabase.js'
import { guarded } from '../lib/audit.js'
import { fromCategory, fromGoal, fromTxRow } from '../lib/financeTransforms.js'
import { loadFinanceData } from '../lib/financeLoader.js'
import { selectAllPages } from '../lib/pagination.js'
import { DEFAULT_TRANSACTION_FORM_FIELDS, normalizeTransactionFormFields } from '../utils/transactionFormFields.js'
import { useLocalStorage } from './useLocalStorage.js'
import { useFinanceOperations } from './useFinanceOperations.js'
import { useGoalOperations } from './useGoalOperations.js'
import { useFinanceDataManagement } from './useFinanceDataManagement.js'

export function useSupabaseFinance() {
  const { user, signOut } = useAuth()
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [budgets, setBudgets] = useState({})
  const [goals, setGoals] = useState([])
  const [reverseGoalHistory, setReverseGoalHistory] = useState([])
  const [reverseGoalContributions, setReverseGoalContributions] = useState([])
  const [standardGoalContributions, setStandardGoalContributions] = useState([])
  const [reverseGoalEvents, setReverseGoalEvents] = useState([])
  const [reverseGoalRetentionMonths, setReverseGoalRetentionMonths] = useState(null)
  const [reverseGoalRetentionLoaded, setReverseGoalRetentionLoaded] = useState(false)
  const [theme, setTheme] = useLocalStorage('planejador:theme', 'auto')
  const [transactionFormFields, setTransactionFormFieldsState] = useState(DEFAULT_TRANSACTION_FORM_FIELDS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isDeletingGoal, setIsDeletingGoal] = useState(false)
  const [goalDeletionPhase, setGoalDeletionPhase] = useState('')
  const latestLoadRequest = useRef(0)
  const deleteGoalInFlight = useRef(false)
  // Guardas de duplo-clique: inserir duas vezes no mesmo instante duplicaria a linha
  const transactionInsertInFlight = useRef(false)
  const categoryInsertInFlight = useRef(false)
  const transactionFormFieldsQueue = useRef(Promise.resolve())
  const confirmedTransactionFormFields = useRef(DEFAULT_TRANSACTION_FORM_FIELDS)
  const transactionFormFieldsVersion = useRef(0)
  const errorTimer = useRef(0)

  // Tres estados de proposito (B78): ausente nao fala de recarga, `true` promete
  // que ela houve, `false` avisa que ela falhou. O default NAO pode ser `false` -
  // os outros dezoito pontos de reporte passariam a avisar de uma recarga que nem
  // tentaram. Mesma licao do B76: ausente nao e `false`.
  const reportError = useCallback((dbError, { reloaded = null } = {}) => {
    const message = translateAuthError(dbError)
    // O sufixo pertence a quem reporta, nao ao banner. App.jsx colava
    // " Os dados foram recarregados do servidor." em TODA mensagem, e mentia em
    // quase todas: validacao local de categoria (:426), 'Backup invalido.'
    // (:628), sessao expirada na importacao (:632), falha ao excluir meta (:596)
    // e o proprio erro de carga (:224) retornam sem recarregar nada. Dos
    // dezenove pontos de reporte deste arquivo - dezessete chamadas e dois
    // `.catch(reportError)` - so o `persist` (:308) tenta recarregar, e por isso
    // so ele passa a flag.
    const suffix = reloaded === true ? ' Os dados foram recarregados do servidor.'
      : reloaded === false ? ' Recarregue a pÃ¡gina: os dados na tela nÃ£o foram confirmados pelo servidor.'
        : ''
    setError(`${message}${suffix}`)
    // Cancela o timer anterior. O callback faz `setError('')` sem saber qual erro
    // esta na tela: com dezenove chamadores, dois erros dentro da janela faziam o
    // timer do primeiro apagar a mensagem do segundo (offline com duas escritas
    // seguidas e o caso comum). O ref tambem serve de limpeza no unmount, logo
    // abaixo - mas o unmount e a parte inofensiva: o React 18 descarta
    // `setState` em componente desmontado sem aviso.
    window.clearTimeout(errorTimer.current)
    // 12 s, nao 6. A mensagem some sozinha e nao ha onde reler depois, mas a
    // maioria carrega instrucao de recuperacao ("Entre novamente para importar o
    // backup", "Mantenha pelo menos uma categoria deste tipo para realocar os
    // lancamentos") - seis segundos nao davam para ler e agir.
    errorTimer.current = window.setTimeout(() => setError(''), 12000)
  }, [])

  useEffect(() => () => window.clearTimeout(errorTimer.current), [])

  // `preserveLoading` tem default `true` de proposito, invertido em 24/08/2026 (B58).
  // Levantar `loading` troca a arvore de App.jsx pelo esqueleto de FinanceLoadingScreen,
  // desmontando Topbar, Sidebar, modais e o formulario aberto - correto na carga inicial,
  // destrutivo em qualquer recarga. Das doze chamadas deste hook, onze querem preservar;
  // so o efeito de montagem pede o esqueleto, e pede explicitamente. Com o default
  // seguro, um `load()` novo escrito sem o parametro nao derruba mais a UI montada.
  const load = useCallback(async ({ preserveError = false, preserveLoading = true } = {}) => {
    const requestId = ++latestLoadRequest.current
    try {
      if (!user || !supabase) {
        console.warn('[finance-load] carregamento ignorado', {
          userPresent: Boolean(user),
          supabaseConfigured: Boolean(supabase),
        })
        if (requestId === latestLoadRequest.current) setLoading(false)
        return false
      }
      if (!preserveLoading) setLoading(true)
      if (!preserveError) setError('')
      console.info('[finance-load] iniciando carregamento', { userPresent: true, supabaseConfigured: true })
      const { profileRequest, supportingDataRequest, primaryDataRequest } = loadFinanceData({ supabase, guarded, selectAllPages })
      const [txResult, catResult, budgetResult, goalResult] = await primaryDataRequest
      // Uma carga iniciada antes de uma mutacao nao pode restaurar um snapshot
      // antigo sobre os dados que acabaram de ser confirmados pelo servidor.
      if (requestId !== latestLoadRequest.current) return false
      const firstError = [txResult, catResult, budgetResult, goalResult].find((r) => r.error)?.error
      if (firstError) {
        const code = String(firstError.code || '')
        const message = String(firstError.message || '').toLowerCase()
        if (code === 'PGRST301' || message.includes('jwt expired') || message.includes('token is expired')) {
          await signOut('session_expired')
          return false
        }
        reportError(firstError)
        // Uma falha de leitura nÃ£o pode transformar a interface em uma
        // Dashboard aparentemente vÃ¡lida, mas zerada. Os Ãºltimos dados sÃ£o
        // preservados atÃ© uma carga posterior bem-sucedida.
        setLoading(false)
        return false
      }
      setTransactions((txResult.data || []).map(fromTxRow))
      setCategories((catResult.data || []).map(fromCategory))
      setBudgets(Object.fromEntries((budgetResult.data || []).map((row) => [row.category_id, Number(row.limit_amount)])))
      setGoals((goalResult.data || []).map(fromGoal))
      setLoading(false)

      // As duas leituras secundarias abaixo sao disparadas antes do await acima e
      // recebem handler apenas agora: sem o catch no fim de cada uma, uma rejeicao
      // nessa janela fica sem tratamento e o navegador emite unhandledrejection.
      void supportingDataRequest.then(async ([reverseHistoryResult, reverseContributionsResult, standardContributionsResult, reverseEventsResult, retentionResult]) => {
        if (requestId !== latestLoadRequest.current) return
        const supportingError = [reverseHistoryResult, reverseContributionsResult, standardContributionsResult, reverseEventsResult, retentionResult].find((result) => result.error)?.error
        if (supportingError) {
          const code = String(supportingError.code || '')
          const message = String(supportingError.message || '').toLowerCase()
          if (code === 'PGRST301' || message.includes('jwt expired') || message.includes('token is expired')) {
            await signOut('session_expired')
            return
          }
          reportError(supportingError)
        }
        // Cada leitura aplica a propria: as cinco tabelas nao tem relacao entre si,
        // e um unico erro descartava as quatro que chegaram - inclusive o sinal de
        // retencao, que deixava o <select> do SettingsPanel desabilitado e pedindo
        // recarga por causa de uma tabela sem relacao com ele.
        if (!reverseHistoryResult.error) setReverseGoalHistory(reverseHistoryResult.data || [])
        if (!reverseContributionsResult.error) setReverseGoalContributions(reverseContributionsResult.data || [])
        if (!standardContributionsResult.error) setStandardGoalContributions(standardContributionsResult.data || [])
        if (!reverseEventsResult.error) setReverseGoalEvents(reverseEventsResult.data || [])
        if (!retentionResult.error) {
          setReverseGoalRetentionMonths(retentionResult.data?.completed_goal_retention_months ?? null)
          setReverseGoalRetentionLoaded(true)
        }
      }).catch(reportError)

      void profileRequest.then((profileResult) => {
        if (requestId !== latestLoadRequest.current) return
        if (profileResult.error) {
          setTransactionFormFieldsState(DEFAULT_TRANSACTION_FORM_FIELDS)
          return
        }
        const confirmedFields = normalizeTransactionFormFields(profileResult.data?.transaction_form_fields)
        confirmedTransactionFormFields.current = confirmedFields
        setTransactionFormFieldsState(confirmedFields)
      }).catch(reportError)
      return true
    } catch (error) {
      // `load` nunca rejeita: os doze chamadores tratam o retorno booleano, e uma
      // rejeicao aqui deixaria `loading` em true para sempre - tela presa no
      // esqueleto de App.jsx:278, sem retry possivel a nao ser recarregar a pagina.
      // O caminho alcancavel e o `await signOut()` das linhas de sessao expirada.
      console.error('[finance-load] falha antes ou durante o carregamento', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      })
      reportError(error)
      if (requestId === latestLoadRequest.current) setLoading(false)
      return false
    }
  // `session` fora das dependencias nao basta por si: quem sustenta a garantia e a
  // estabilizacao da identidade de `user` no AuthContext (comparacao por id e
  // updated_at). Sem ela, TOKEN_REFRESHED entrega um objeto novo, recria este
  // callback e dispara a carga completa a cada renovacao de token.
  }, [reportError, signOut, user])

  // Unica chamada que mostra o esqueleto, e a unica que passa o flag explicito:
  // na montagem nao ha UI para preservar. Ver o default invertido em `load`.
  useEffect(() => { load({ preserveLoading: false }) }, [load])

  const persist = useCallback(async (operation, context) => {
    const result = await guarded(operation, context)
    if (result.error) {
      // Reportar DEPOIS da recarga, nao antes (B78): o `preserveError` cobre o
      // setError('') de :187 (B54), mas nao o reportError(firstError) de :224 -
      // na falha dupla a mensagem da leitura apagava a da escrita e sobrava
      // estado otimista na tela sem aviso nenhum. A ordem garante que a escrita
      // e a ultima a falar, e o `reloaded` sai do RETORNO do load: promessa
      // cumprida, nao asserida. `preserveLoading` explicito embora seja o default
      // (B58) - o esqueleto de FinanceLoadingScreen taparia a mensagem. Vale para
      // as doze escritas otimistas que passam por aqui.
      const reloaded = await load({ preserveError: true, preserveLoading: true })
      reportError(result.error, { reloaded })
      return false
    }
    return true
  }, [load, reportError])

  const { addTransaction, updateTransaction, deleteTransaction, duplicateTransaction, togglePaid, addCategory, updateCategory, deleteCategory, setBudget } = useFinanceOperations({ persist, user, transactions, categories, setTransactions, setCategories, setBudgets, reportError, transactionInsertInFlight, categoryInsertInFlight })

  const { addGoal, addStandardGoalContribution, updateStandardGoalContribution, addReverseGoal, addReverseGoalContribution, updateReverseGoalContribution, setReverseGoalRetention, updateGoal, updateReverseGoal, deleteGoal } = useGoalOperations({ load, persist, guarded, reportError, user, deleteGoalInFlight, latestLoadRequest, setGoals, setReverseGoalHistory, setReverseGoalContributions, setStandardGoalContributions, setReverseGoalEvents, setIsDeletingGoal, setGoalDeletionPhase })

  const { exportData, importData, clearAll, setTransactionFormFields } = useFinanceDataManagement({ transactions, categories, budgets, goals, standardGoalContributions, reverseGoalContributions, reverseGoalHistory, reverseGoalEvents, reverseGoalRetentionMonths, setTransactionFormFieldsState, confirmedTransactionFormFields, transactionFormFieldsQueue, transactionFormFieldsVersion, load, guarded, reportError, user })

  return { transactions, categories, budgets, goals, theme, transactionFormFields, loading, error, isDeletingGoal, goalDeletionPhase,
    addTransaction, updateTransaction, deleteTransaction, duplicateTransaction, togglePaid,
    addCategory, updateCategory, deleteCategory, setBudget, addGoal, addReverseGoal, addReverseGoalContribution, updateReverseGoalContribution, addStandardGoalContribution, updateStandardGoalContribution, updateGoal, updateReverseGoal, deleteGoal,
    reverseGoalHistory, reverseGoalContributions, standardGoalContributions, reverseGoalEvents, reverseGoalRetentionMonths, reverseGoalRetentionLoaded,
    setReverseGoalRetention,
    setTheme, setTransactionFormFields, exportData, importData, clearAll }
}


