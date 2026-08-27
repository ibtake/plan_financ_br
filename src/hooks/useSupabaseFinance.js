import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase, translateAuthError } from '../lib/supabase.js'
import { guarded } from '../lib/audit.js'
import { fromCategory, fromGoal } from '../lib/financeTransforms.js'
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
      : reloaded === false ? ' Recarregue a página: os dados na tela não foram confirmados pelo servidor.'
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
        if (requestId === latestLoadRequest.current) setLoading(false)
        return false
      }
      if (!preserveLoading) setLoading(true)
      if (!preserveError) setError('')
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
        // Uma falha de leitura não pode transformar a interface em uma
        // Dashboard aparentemente válida, mas zerada. Os últimos dados são
        // preservados até uma carga posterior bem-sucedida.
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

  /* Legacy operations moved to useFinanceOperations.
  const updateTransactionLegacy = useCallback((id, input, occurrenceIndex = 0) => {
    const rootId = String(id).split('#')[0]
    const patch = Number(occurrenceIndex) > 0
      ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'date' && key !== 'paid'))
      : input
    // O lancamento e resolvido aqui fora, e nao dentro do updater. Antes o
    // `updated` era atribuido dentro do `setTransactions` e lido na linha
    // seguinte: isso so funciona porque o React, quando o fiber esta limpo,
    // executa o updater na hora para decidir se pode dispensar o re-render -
    // otimizacao interna, nao contrato de API. Com atualizacao pendente no
    // fiber o updater roda so na renderizacao, `updated` fica `undefined` e a
    // escrita nao saia: a edicao aparecia na tela e desaparecia na recarga. Hoje
    // o unico chamador (App.jsx:177) e a primeira instrucao do submit, o que
    // mantinha o fiber limpo por acaso. `transactions` nas deps nao custa
    // render: nenhum consumidor memoizado recebe esta funcao (App.jsx:168-173).
    const current = transactions.find((tx) => tx.id === rootId)
    if (!current) return
    const updated = normalizeTransaction({ ...current, ...patch, id: rootId })
    setTransactions((prev) => prev.map((tx) => (tx.id === rootId ? updated : tx)))
    void persist(
      () => supabase.from('transactions').update(toTxRow(updated, user.id)).eq('id', rootId).eq('user_id', user.id),
      { table: 'transactions', action: 'update' },
    )
  }, [persist, transactions, user])

  const deleteTransactionLegacy = useCallback((id) => {
    const rootId = String(id).split('#')[0]
    setTransactions((prev) => prev.filter((tx) => tx.id !== rootId))
    void persist(() => supabase.from('transactions').delete().eq('id', rootId).eq('user_id', user.id), { table: 'transactions', action: 'delete' })
  }, [persist, user])

  const duplicateTransactionLegacy = useCallback((occurrence) => addTransactionLegacy({
    ...occurrence, id: uid(), description: `${occurrence.description} (cópia)`, recurrence: 'none',
    installments: 1, paidOccurrences: {}, createdAt: new Date().toISOString(),
  }), [addTransaction])

  const togglePaidLegacy = useCallback((occurrence) => {
    const rootId = occurrence.sourceId || String(occurrence.id).split('#')[0]
    const index = occurrence.occurrenceIndex || 0
    void persist(async () => {
      const result = await supabase.rpc('toggle_paid_occurrence', {
        p_transaction_id: rootId,
        p_occurrence_index: index,
      })
      if (!result.error && result.data) {
        const updated = fromTxRow(result.data)
        setTransactions((prev) => prev.map((tx) => tx.id === rootId ? updated : tx))
      }
      return result
    }, { table: 'transactions', action: 'toggle_paid' })
  }, [persist])

  const addCategory = useCallback((input) => {
    // Mesma guarda de duplo-clique do addTransaction (id aleatorio a cada chamada).
    if (categoryInsertInFlight.current) return
    categoryInsertInFlight.current = true
    try {
      const base = String(input.name || 'cat').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      // O sufixo era `Math.random().toString(36).slice(2, 5)`: 3 chars base36 =
      // 15,5 bits, 46.656 combinacoes e nenhum timestamp - 50% de chance de
      // colisao em ~254 categorias do mesmo nome-base, ordens de magnitude
      // mais alcancavel que o uid(). Colisao nao corrompia (a PK (user_id, id)
      // de schema.sql:617 recusa o insert e o persist recarrega, desfazendo o
      // otimista da linha abaixo), mas a categoria evaporava com erro. Os 8
      // chars do randomUUID sao CSPRNG e mantem o id legivel (B51).
      const cat = { id: input.id || `${base}-${crypto.randomUUID().slice(0, 8)}`, name: String(input.name || 'Nova categoria').trim(), type: normalizeType(input.type), color: input.color || '#6366f1', icon: input.icon || '📁', targetPercentage: Math.max(0, Math.min(100, Number(input.targetPercentage) || 0)), custom: true }
      setCategories((prev) => [...prev, cat])
      void persist(() => supabase.from('categories').insert(toCategory(cat, user.id)), { table: 'categories', action: 'insert' })
        .finally(() => { categoryInsertInFlight.current = false })
    } catch (error) {
      categoryInsertInFlight.current = false
      throw error
    }
  }, [persist, user])

  const updateCategory = useCallback((id, patch) => {
    setCategories((prev) => prev.map((cat) => cat.id === id ? { ...cat, ...patch } : cat))
    // Traduz o estado (camelCase) para as colunas do banco (snake_case)
    const allowed = {}
    if (patch.name !== undefined) allowed.name = patch.name
    if (patch.type !== undefined) allowed.type = normalizeType(patch.type)
    if (patch.color !== undefined) allowed.color = patch.color
    if (patch.icon !== undefined) allowed.icon = patch.icon
    if (patch.targetPercentage !== undefined) {
      allowed.target_percentage = Math.max(0, Math.min(100, Number(patch.targetPercentage) || 0))
    }
    void persist(() => supabase.from('categories').update(allowed).eq('id', id).eq('user_id', user.id), { table: 'categories', action: 'update' })
  }, [persist, user])

  const deleteCategory = useCallback((id) => {
    const category = categories.find((cat) => cat.id === id)
    const fallback = categories.find((cat) => cat.id === fallbackCategoryId(category?.type))
      || categories.find((cat) => cat.type === category?.type && cat.id !== id)
    if (!category || !fallback) {
      reportError({ message: 'Mantenha pelo menos uma categoria deste tipo para realocar os lançamentos.' })
      return
    }
    // Reatribui os lancamentos a uma categoria "Outros" do mesmo grupo ANTES de
    // excluir. Nao e por chave estrangeira - `transactions.category_id` e text puro
    // (schema.sql:674), sem `references`. O que a realocacao evita e lancamento
    // orfao, apontando para um id que nao existe mais em categories.
    const fallbackId = fallback.id
    setCategories((prev) => prev.filter((cat) => cat.id !== id))
    setBudgets((prev) => { const next = { ...prev }; delete next[id]; return next })
    setTransactions((prev) => prev.map((tx) => tx.categoryId === id ? { ...tx, categoryId: fallbackId } : tx))
    void (async () => {
      // Ordem importa: primeiro solta as referencias, depois remove a categoria.
      // persist() recarrega do servidor em caso de erro, mantendo a UI coerente.
      const okTx = await persist(() => supabase.from('transactions').update({ category_id: fallbackId }).eq('category_id', id).eq('user_id', user.id), { table: 'transactions', action: 'update_category' })
      const okBudget = await persist(() => supabase.from('budgets').delete().eq('category_id', id).eq('user_id', user.id), { table: 'budgets', action: 'delete' })
      // So exclui a categoria depois que as dependencias sairam com sucesso.
      if (okTx && okBudget) {
        await persist(() => supabase.from('categories').delete().eq('id', id).eq('user_id', user.id), { table: 'categories', action: 'delete' })
      }
    })()
  }, [categories, persist, reportError, user])

  const setBudget = useCallback((categoryId, limit) => {
    const amount = Number(limit) || 0
    setBudgets((prev) => { const next = { ...prev }; if (amount <= 0) delete next[categoryId]; else next[categoryId] = amount; return next })
    if (amount <= 0) void persist(() => supabase.from('budgets').delete().eq('category_id', categoryId).eq('user_id', user.id), { table: 'budgets', action: 'delete' })
    else void persist(() => supabase.from('budgets').upsert({ user_id: user.id, category_id: categoryId, limit_amount: amount }), { table: 'budgets', action: 'upsert' })
  }, [persist, user])

  */
  const { addGoal, addStandardGoalContribution, updateStandardGoalContribution, addReverseGoal, addReverseGoalContribution, updateReverseGoalContribution, setReverseGoalRetention, updateGoal, updateReverseGoal, deleteGoal } = useGoalOperations({ load, persist, guarded, reportError, user, deleteGoalInFlight, latestLoadRequest, setGoals, setReverseGoalHistory, setReverseGoalContributions, setStandardGoalContributions, setReverseGoalEvents, setIsDeletingGoal, setGoalDeletionPhase })

  /* Legacy goal operations moved to useGoalOperations.
  const callGoalRpc = useCallback(async (operation, action) => {
    try {
      const result = await guarded(operation, { table: 'goals', action })
      if (result?.error) {
        reportError(result.error)
        return false
      }
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }, [reportError])

  const addGoal = useCallback(async (input) => {
    const ok = await callGoalRpc(() => supabase.rpc('create_standard_goal', {
      p_name: String(input.name || '').trim(),
      p_target: Math.abs(Number(input.target) || 0),
      p_initial_contribution: Math.abs(Number(input.current) || 0),
      p_deadline: input.deadline || null,
      p_icon: input.icon || '🎯',
      p_color: input.color || '#6366f1',
    }), 'create_standard')
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const addStandardGoalContribution = useCallback(async (goalId, input) => {
    const ok = await callGoalRpc(() => supabase.rpc('add_standard_goal_contribution', {
      p_goal_id: goalId,
      p_amount: Math.abs(Number(input.amount) || 0),
      p_occurred_on: input.occurredOn,
    }), 'add_standard_contribution')
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const updateStandardGoalContribution = useCallback(async (contributionId, input) => {
    const ok = await callGoalRpc(() => supabase.rpc('update_standard_goal_contribution', {
      p_contribution_id: contributionId,
      p_amount: Math.abs(Number(input.amount) || 0),
      p_occurred_on: input.occurredOn,
    }), 'update_standard_contribution')
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const addReverseGoal = useCallback(async (input) => {
    const ok = await callGoalRpc(() => supabase.rpc('create_reverse_goal', {
      p_name: String(input.name || '').trim(),
      p_original_amount: Math.abs(Number(input.originalAmount) || 0),
      p_initial_contribution: Math.abs(Number(input.initialContribution) || 0),
      p_start_date: input.startDate,
      p_selic_factor: Number(input.selicFactor) || 1,
      p_icon: input.icon || '🎯',
      p_color: input.color || '#6366f1',
    }), 'create_reverse')
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const addReverseGoalContribution = useCallback(async (goalId, input) => {
    const ok = await callGoalRpc(() => supabase.rpc('add_reverse_goal_contribution', {
      p_goal_id: goalId,
      p_amount: Math.abs(Number(input.amount) || 0),
      p_occurred_on: input.occurredOn,
      p_note: String(input.note || '').trim() || null,
    }), 'add_reverse_contribution')
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const updateReverseGoalContribution = useCallback(async (contributionId, input) => {
    const ok = await callGoalRpc(() => supabase.rpc('update_reverse_goal_contribution', {
      p_contribution_id: contributionId,
      p_amount: Math.abs(Number(input.amount) || 0),
      p_occurred_on: input.occurredOn,
    }), 'update_reverse_contribution')
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const setReverseGoalRetention = useCallback(async (months) => {
    const value = months === null || months === '' ? null : Number(months)
    const ok = await callGoalRpc(() => supabase.rpc('set_reverse_goal_retention', { p_months: value }), 'set_reverse_retention')
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const updateGoal = useCallback(async (id, patch) => {
    const ok = await callGoalRpc(() => supabase.rpc('update_standard_goal_metadata', {
      p_goal_id: id,
      p_name: String(patch.name || '').trim(),
      p_target: Math.abs(Number(patch.target) || 0),
      p_deadline: patch.deadline || null,
      p_icon: patch.icon || '🎯',
      p_color: patch.color || '#6366f1',
    }), 'update_standard_metadata')
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [callGoalRpc, load])

  const updateReverseGoal = useCallback(async (id, input) => {
    const patch = {
      name: String(input.name || '').trim(),
      icon: input.icon || '🎯',
      color: input.color || '#6366f1',
    }
    if (!patch.name) return false

    const ok = await persist(
      () => supabase.from('goals').update(patch).eq('id', id).eq('user_id', user.id).eq('goal_type', 'reverse'),
      { table: 'goals', action: 'update_reverse_metadata' },
    )
    if (!ok) return false
    await load({ preserveLoading: true })
    return true
  }, [load, persist, user])

  const deleteGoal = useCallback(async (id) => {
    if (!supabase || !user || deleteGoalInFlight.current) return false

    deleteGoalInFlight.current = true
    setIsDeletingGoal(true)
    setGoalDeletionPhase('deleting')
    try {
      const { error: deleteError } = await guarded(
        () => supabase.rpc('delete_goal', { p_goal_id: id }),
        { table: 'goals', action: 'delete' },
      )

      if (deleteError) {
        reportError(deleteError)
        return false
      }

      // A RPC e transacional: se ela retornou sem erro, a exclusao ja foi
      // confirmada no servidor. Leituras posteriores podem atrasar ou falhar
      // sem transformar uma meta ja excluida em um card fantasma no cliente.
      latestLoadRequest.current += 1
      setGoals((prev) => prev.filter((goal) => goal.id !== id))
      setReverseGoalHistory((prev) => prev.filter((item) => item.goal_id !== id))
      setReverseGoalContributions((prev) => prev.filter((item) => item.goal_id !== id))
      setReverseGoalEvents((prev) => prev.filter((item) => item.goal_id !== id))
      setStandardGoalContributions((prev) => prev.filter((item) => item.goal_id !== id))
      return true
    } catch (deleteException) {
      reportError(deleteException)
      return false
    } finally {
      deleteGoalInFlight.current = false
      setGoalDeletionPhase('')
      setIsDeletingGoal(false)
    }
  }, [reportError, user])

  */
  const { exportData, importData, clearAll, setTransactionFormFields } = useFinanceDataManagement({ transactions, categories, budgets, goals, standardGoalContributions, reverseGoalContributions, reverseGoalHistory, reverseGoalEvents, reverseGoalRetentionMonths, setTransactionFormFieldsState, confirmedTransactionFormFields, transactionFormFieldsQueue, transactionFormFieldsVersion, load, guarded, reportError, user })

  /* Legacy data-management operations moved to useFinanceDataManagement.
  const exportData = useCallback(() => ({
    transactions, categories, budgets, goals, standardGoalContributions,
    reverseGoalContributions, reverseGoalHistory, reverseGoalEvents,
    reverseGoalRetentionMonths,
  }), [transactions, categories, budgets, goals, standardGoalContributions, reverseGoalContributions, reverseGoalEvents, reverseGoalHistory, reverseGoalRetentionMonths])

  const importData = useCallback(async (data, pgblPlans = data?.pgblPlans) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      reportError({ message: 'Backup inválido.' })
      return false
    }
    if (!supabase || !user) {
      reportError({ message: 'Sessão expirada. Entre novamente para importar o backup.' })
      return false
    }
    // B41: mesma regra do formulario, mesma mensagem. Bloqueia o backup INTEIRO,
    // como os dois guards acima - a RPC replace_my_data e transacional e trocar
    // tudo menos uma linha deixaria o arquivo e o banco em desacordo silencioso.
    // So o que vem no arquivo e conferido: `transactions` do estado ja passou
    // pelo formulario. Nomeia o lancamento porque quem importa precisa achar a
    // linha errada num JSON, e a mensagem sozinha nao diz qual e.
    const badEnd = (Array.isArray(data.transactions) ? data.transactions : []).find(recurrenceEndBeforeStart)
    if (badEnd) {
      reportError({ message: `${RECURRENCE_END_ERROR} Corrija "${String(badEnd.description || 'sem descrição').slice(0, 60)}" no arquivo e importe de novo.` })
      return false
    }

    // O try cobre tambem a montagem do payload, nao so a chamada da RPC: o
    // validador de importJSON confere o tipo de cada colecao, nao o de cada
    // item, entao um `null` dentro de qualquer lista lancaria aqui e travaria a
    // tela no estado "importando" sem nenhuma mensagem.
    try {
      const txs = Array.isArray(data.transactions) ? data.transactions.map(normalizeTransaction) : transactions
      const cats = Array.isArray(data.categories) && data.categories.length ? data.categories : categories
      const nextBudgets = data.budgets && typeof data.budgets === 'object' ? data.budgets : budgets
      // Campo ausente vira `undefined` para que a chave saia do JSON: a RPC
      // replace_my_data tem fallback proprio (reconstroi os aportes a partir de
      // goals.current). Enviar [] apagaria o historico de backups antigos.
      const nextStandardGoalContributions = Array.isArray(data.standardGoalContributions) ? data.standardGoalContributions : undefined
      const nextGoals = Array.isArray(data.goals) ? data.goals.map((goal) => ({ ...goal, id: goal.id || uid(), name: String(goal.name || 'Meta'), target: Math.abs(Number(goal.target) || 0), current: Math.abs(Number(goal.current) || 0), deadline: goal.deadline || '', icon: goal.icon || '🎯', color: goal.color || '#6366f1' })) : goals

      // REQ 9 (auditoria V-05, Opcao B): uma unica RPC transacional substitui o
      // antigo delete_my_data + Promise.all. Se qualquer insert falhar, o Postgres
      // faz rollback e os dados antigos permanecem intactos.
      const payload = {
        categories: cats.map((cat) => ({
          id: cat.id,
          name: cat.name,
          icon: cat.icon || '📁',
          color: cat.color || '#6366f1',
          type: normalizeType(cat.type),
          target_percentage: Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0)),
        })),
        transactions: txs.map((tx) => toTxRow(tx, user.id)),
        // A RPC le budgets como recordset {category_id, limit_amount}; o estado
        // guarda um mapa {categoryId: valor}, entao convertemos para array.
        budgets: Object.entries(nextBudgets).map(([categoryId, amount]) => ({
          category_id: categoryId,
          limit_amount: Number(amount) || 0,
        })),
        goals: nextGoals.map((goal) => ({ ...toGoal(goal, user.id), goal_type: goal.goalType || goal.goal_type || 'standard', reverse_original_amount: goal.reverseOriginalAmount ?? goal.reverse_original_amount, reverse_remaining_amount: goal.reverseRemainingAmount ?? goal.reverse_remaining_amount, reverse_corrected_amount: goal.reverseCorrectedAmount ?? goal.reverse_corrected_amount, reverse_start_date: goal.reverseStartDate ?? goal.reverse_start_date, reverse_selic_factor: goal.reverseSelicFactor ?? goal.reverse_selic_factor, reverse_completed_at: goal.reverseCompletedAt ?? goal.reverse_completed_at, reverse_total_contributed: goal.reverseTotalContributed ?? goal.reverse_total_contributed, reverse_correction_amount: goal.reverseCorrectionAmount ?? goal.reverse_correction_amount, reverse_progress_percent: goal.reverseProgressPercent ?? goal.reverse_progress_percent, reverse_monthly_contribution_average: goal.reverseMonthlyContributionAverage ?? goal.reverse_monthly_contribution_average, reverse_forecast_completion_date: goal.reverseForecastCompletionDate ?? goal.reverse_forecast_completion_date })),
        // Colecao ausente no arquivo significa "manter o que ja existe". A RPC
        // reinsere as colecoes reversas com JOIN em goals, entao referencias a
        // metas que nao vieram no backup sao descartadas sem erro.
        standardGoalContributions: nextStandardGoalContributions,
        reverseGoalContributions: Array.isArray(data.reverseGoalContributions) ? data.reverseGoalContributions : reverseGoalContributions,
        reverseGoalHistory: Array.isArray(data.reverseGoalHistory) ? data.reverseGoalHistory : reverseGoalHistory,
        reverseGoalEvents: Array.isArray(data.reverseGoalEvents) ? data.reverseGoalEvents : reverseGoalEvents,
        // Aqui `null` E valor (retencao desativada), so a chave ausente cai no
        // fallback: com `??` um backup feito com a retencao desligada voltava com
        // ela ligada e o cleanup_expired_reverse_goals apagava as metas concluidas.
        reverseGoalRetentionMonths: data.reverseGoalRetentionMonths === undefined ? reverseGoalRetentionMonths : data.reverseGoalRetentionMonths,
        // O app carrega o plano com a chave `params` (usePGBL.fromRow) e a RPC le
        // `fiscal_params`, coluna NOT NULL: sem a traducao o insert viola a
        // constraint e o restore inteiro sofre rollback.
        pgblPlans: (Array.isArray(pgblPlans) ? pgblPlans : []).map((plan) => ({
          year: Number(plan.year),
          months: plan.months || [],
          premise: plan.premise || {},
          fiscal_params: plan.fiscal_params ?? plan.params ?? {},
        })),
      }

      const { error: rpcError } = await guarded(
        () => supabase.rpc('replace_my_data', { p_data: payload }),
        { table: 'user_data', action: 'import' },
      )
      if (rpcError) {
        reportError(rpcError)
        return false
      }
      await logEvent(EVENTS.DATA_IMPORTED, 'warning', { transactions: txs.length, goals: nextGoals.length })
    } catch (error) {
      reportError(error)
      return false
    }
    // Explicito embora seja o default (B58): o esqueleto remontaria o SettingsPanel
    // sem a mensagem de resultado da importacao.
    await load({ preserveLoading: true })
    return true
  }, [budgets, categories, goals, load, reportError, reverseGoalContributions, reverseGoalEvents, reverseGoalHistory, reverseGoalRetentionMonths, transactions, user])

  const clearAll = useCallback(async () => {
    if (!supabase || !user) return false
    try {
      const { error } = await guarded(
        () => supabase.rpc('reset_my_data_with_defaults'),
        { table: 'user_data', action: 'reset_with_defaults' },
      )
      if (error) {
        reportError(error)
        return false
      }
      await load({ preserveLoading: true })
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }, [load, reportError, user])

  const setTransactionFormFields = useCallback((fields) => {
    const next = normalizeTransactionFormFields(fields)
    const version = ++transactionFormFieldsVersion.current
    setTransactionFormFieldsState(next)
    if (!supabase || !user) {
      setTransactionFormFieldsState(confirmedTransactionFormFields.current)
      return Promise.resolve(false)
    }

    // Cada alteracao grava o objeto inteiro, portanto as requisicoes precisam
    // ser seriadas. Sem a fila, uma resposta antiga pode sobrescrever uma
    // preferencia mais recente em redes lentas ou instaveis.
    transactionFormFieldsQueue.current = transactionFormFieldsQueue.current
      .catch(() => undefined)
      .then(async () => {
        const { error: updateError } = await guarded(
          () => supabase.from('profiles').update({ transaction_form_fields: next }).eq('id', user.id),
          { table: 'profiles', action: 'update_transaction_form_fields' },
        )
        if (updateError) {
          reportError(updateError)
          // Uma falha antiga nao pode desfazer uma alteracao mais recente que
          // ainda esteja na fila. Se esta for a ultima preferencia escolhida,
          // restaura o ultimo estado efetivamente confirmado pelo servidor.
          if (version === transactionFormFieldsVersion.current) {
            setTransactionFormFieldsState(confirmedTransactionFormFields.current)
          }
          return false
        }
        confirmedTransactionFormFields.current = next
        return true
      })

    return transactionFormFieldsQueue.current
  }, [reportError, user])

  */
  return { transactions, categories, budgets, goals, theme, transactionFormFields, loading, error, isDeletingGoal, goalDeletionPhase,
    addTransaction, updateTransaction, deleteTransaction, duplicateTransaction, togglePaid,
    addCategory, updateCategory, deleteCategory, setBudget, addGoal, addReverseGoal, addReverseGoalContribution, updateReverseGoalContribution, addStandardGoalContribution, updateStandardGoalContribution, updateGoal, updateReverseGoal, deleteGoal,
    reverseGoalHistory, reverseGoalContributions, standardGoalContributions, reverseGoalEvents, reverseGoalRetentionMonths, reverseGoalRetentionLoaded,
    setReverseGoalRetention,
    setTheme, setTransactionFormFields, exportData, importData, clearAll }
}
