import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import Sidebar from './components/Sidebar.jsx'
import BottomNav from './components/BottomNav.jsx'
import Topbar from './components/Topbar.jsx'
import SummaryCards from './components/SummaryCards.jsx'
import TransactionForm from './components/TransactionForm.jsx'
import TransactionList from './components/TransactionList.jsx'
import BudgetPanel from './components/BudgetPanel.jsx'
import GoalsPanel from './components/GoalsPanel.jsx'
import Insights from './components/Insights.jsx'
import FixedExpenses from './components/FixedExpenses.jsx'
import CategoryManager from './components/CategoryManager.jsx'
import IconManager from './components/IconManager.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import SecurityPanel from './components/SecurityPanel.jsx'
import PGBLPanel from './components/PGBLPanel.jsx'
import AuthScreen from './components/auth/AuthScreen.jsx'
import ResetPasswordScreen from './components/auth/ResetPasswordScreen.jsx'
import RequiredPasswordChange from './components/auth/RequiredPasswordChange.jsx'
import { useAuth } from './contexts/AuthContext.jsx'
import { useMonthlyData } from './hooks/useFinance.js'
import { useLocalStorage } from './hooks/useLocalStorage.js'
import { useSupabaseFinance } from './hooks/useSupabaseFinance.js'
import { usePGBL } from './hooks/usePGBL.js'
import { currentMonthKey, isoDateInMonth, monthLabel } from './utils/format.js'
import { isRecurring } from './utils/recurrence.js'
import { exportCSV, exportJSON } from './utils/exporters.js'
import { buildSampleData } from './utils/sampleData.js'

/**
 * Os graficos carregam a biblioteca recharts, responsavel pela maior parte do
 * peso do bundle. Com lazy() ela sai do carregamento inicial e chega apenas
 * quando a aba "Visao geral" e realmente renderizada.
 */
const CategoryChart = lazy(() => import('./components/CategoryChart.jsx'))
const MonthlyChart = lazy(() => import('./components/MonthlyChart.jsx'))
const TrendChart = lazy(() => import('./components/TrendChart.jsx'))

/** Reserva o espaco do grafico enquanto o chunk chega, evitando salto de layout */
function ChartFallback({ height = 240 }) {
  return (
    <div className="card">
      <div className="chart-loading" style={{ height }}>
        <div className="spinner" />
      </div>
    </div>
  )
}

/** Mantem o contexto da dashboard visivel enquanto os dados autenticados chegam. */
function FinanceLoadingScreen() {
  return (
    <div className="finance-loading-shell" role="status" aria-live="polite" aria-label="Carregando seus dados financeiros" aria-busy="true">
      <aside className="finance-loading-sidebar" aria-hidden="true">
        <div className="loading-brand"><span className="skeleton skeleton-logo" /><span className="skeleton skeleton-brand" /></div>
        <div className="loading-nav">
          {[1, 2, 3, 4, 5, 6].map((item) => <span className="skeleton skeleton-nav" key={item} />)}
        </div>
      </aside>
      <main className="finance-loading-main">
        <div className="finance-loading-topbar" aria-hidden="true">
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-action" />
        </div>
        <div className="finance-loading-content">
          <div className="finance-loading-heading">
            <span className="skeleton skeleton-heading" />
            <span className="skeleton skeleton-subheading" />
          </div>
          <div className="finance-loading-kpis" aria-hidden="true">
            {[1, 2, 3, 4].map((item) => (
              <div className="finance-loading-kpi" key={item}>
                <span className="skeleton skeleton-label" />
                <span className="skeleton skeleton-number" />
                <span className="skeleton skeleton-detail" />
              </div>
            ))}
          </div>
          <div className="finance-loading-chart skeleton" aria-hidden="true" />
          <div className="finance-loading-bottom" aria-hidden="true">
            <div className="finance-loading-panel skeleton" />
            <div className="finance-loading-panel skeleton" />
          </div>
        </div>
        <span className="finance-loading-message">Atualizando seu resumo financeiro…</span>
      </main>
    </div>
  )
}

/** Titulo e descricao exibidos no topo de cada painel */
const PAGE_META = {
  overview: { title: 'Visão geral', sub: 'Resumo do mês, gráficos e alertas' },
  transactions: { title: 'Lançamentos', sub: 'Todas as entradas e saídas do período' },
  budget: { title: 'Orçamento', sub: 'Limites por categoria e acompanhamento' },
  goals: { title: 'Metas', sub: 'Objetivos financeiros e progresso' },
  pgbl: { title: 'Aporte Certo', sub: 'Planeje seu PGBL e o Imposto de Renda' },
  categories: { title: 'Categorias', sub: 'Organize seus lançamentos' },
  icons: { title: 'Ícones', sub: 'Personalize os ícones do aplicativo' },
  security: { title: 'Segurança', sub: 'Sessões, autenticação e atividade da conta' },
  settings: { title: 'Configurações', sub: 'Preferências, backup e dados' },
}

export default function App() {
  const auth = useAuth()
  const isResetPasswordRoute = typeof window !== 'undefined' && window.location.pathname === '/reset-password'

  if (isResetPasswordRoute) return <ResetPasswordScreen />

  if (auth.loading) {
    return <div className="app-loading"><div className="spinner" /><span>Verificando sessão...</span></div>
  }

  if (!auth.session || auth.mfaStage === 'required') return <AuthScreen />
  // Lido da sessao, nao de `auth.user`: a identidade de `user` e estabilizada no
  // AuthContext, e esta claim precisa do objeto fresco de cada renovacao para que
  // a troca obrigatoria marcada por um admin chegue sem recarregar a pagina.
  // String() para o mesmo critério do banco e das Edge Functions (schema.sql:132
  // le o claim com `->>`, que casa boolean true e string 'true').
  if (String(auth.session?.user?.app_metadata?.must_change_password) === 'true') return <RequiredPasswordChange />

  return <AuthenticatedApp />
}

function AuthenticatedApp() {
  const auth = useAuth()
  const finance = useSupabaseFinance()
  const pgbl = usePGBL()
  const [monthKey, setMonthKey] = useState(currentMonthKey())
  const [isMonthPending, startMonthTransition] = useTransition()
  const [activeTab, setActiveTab] = useState('overview')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [notificationFocus, setNotificationFocus] = useState(null)
  const [privacyVisible, setPrivacyVisible] = useLocalStorage('finance-privacy-visible', true)
  const [systemTheme, setSystemTheme] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  ))
  // Busca do topo: o mesmo filtro que ja existia na lista, agora acessivel
  // de qualquer painel.
  const [search, setSearch] = useState('')
  const monthly = useMonthlyData(finance.transactions, monthKey)
  // "Posicao atual" ancora no mes real de hoje; lancamentos de meses futuros
  // so entram quando o usuario avanca o seletor para alem do mes atual.
  const chartMonthKey = monthKey > currentMonthKey() ? monthKey : currentMonthKey()
  const chartMonthly = useMonthlyData(finance.transactions, chartMonthKey)
  const theme = finance.theme === 'dark' || finance.theme === 'light' ? finance.theme : systemTheme

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event) => setSystemTheme(event.matches ? 'dark' : 'light')

    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.documentElement.dataset.privacy = privacyVisible ? 'visible' : 'hidden'
  }, [privacyVisible, theme])

  const toggleTheme = () => finance.setTheme(theme === 'dark' ? 'light' : 'dark')
  const togglePrivacy = () => {
    const next = !privacyVisible
    document.documentElement.dataset.privacy = next ? 'visible' : 'hidden'
    setPrivacyVisible(next)
  }
  const openNew = () => { setEditing(null); setFormOpen(true) }
  // openEdit e deleteTransaction sao as unicas duas props de funcao instaveis que
  // chegam ao memo de TransactionItem (TransactionList.jsx:31) - togglePaid e
  // duplicateTransaction ja saem estaveis do hook. Sem useCallback, o memo compara
  // arrow nova a cada render e re-renderiza as centenas de linhas a cada tecla da
  // busca do topo ou ao abrir o modal. openNew fica fora de proposito: nenhum
  // consumidor dele e memoizado, entao ali seria cerimonia.
  const openEdit = useCallback((occurrence) => { setEditing(occurrence); setFormOpen(true) }, [])

  const saveTransaction = (data) => {
    if (editing) finance.updateTransaction(editing.sourceId || editing.id, data, editing.occurrenceIndex)
    else finance.addTransaction(data)
    if (notificationFocus) {
      setNotificationFocus(null)
      setActiveTab('overview')
    }
  }

  const deleteTransaction = useCallback((occurrence) => {
    // Era `occurrence.sourceId || String(occurrence.id).includes('#')`, e o
    // primeiro operando e sempre verdadeiro: makeOccurrence (recurrence.js:97)
    // grava `sourceId: tx.id` nas cinco saidas de occurrencesInMonth, entao o
    // aviso aparecia em todo delete - inclusive num lancamento unico, sem
    // recorrencia e sem parcela, que lia "exclui toda a serie" sem ter serie -
    // e o teste do `#` nunca era avaliado, morto atras do short-circuit (B46).
    // isRecurring ja e o predicado certo e ja roda em FixedExpenses.jsx:12.
    const scope = isRecurring(occurrence)
      ? ' Esta ação exclui toda a série ou todas as parcelas.'
      : ''
    if (window.confirm(`Excluir “${occurrence.description}”?${scope}`)) {
      // Segue `sourceId || id`: e a raiz da serie, e o hook ainda corta o `#`
      // por conta propria (useFinanceOperations.js:35). Nao ha exclusao de
      // ocorrencia isolada no app - todo delete apaga a serie inteira.
      finance.deleteTransaction(occurrence.sourceId || occurrence.id)
    }
  }, [finance.deleteTransaction])

  const pending = useMemo(
    () => monthly.occurrences.filter((item) => !item.paid),
    [monthly.occurrences],
  )
  const pendingCount = pending.length
  const pendingTotal = useMemo(
    () => pending.reduce((sum, item) => sum + (item.type === 'income' ? 0 : item.amount), 0),
    [pending],
  )

  // Buscar leva direto para a lista, unico painel que consome o filtro
  const handleSearch = (value) => {
    setSearch(value)
    if (value && activeTab !== 'transactions') setActiveTab('transactions')
  }

  const insightProps = {
    summary: monthly.summary,
    previousSummary: monthly.previousSummary,
    byCategory: monthly.byCategory,
    previousByCategory: monthly.previousByCategory,
    budgets: finance.budgets,
    categories: finance.categories,
    occurrences: monthly.occurrences,
    goals: finance.goals,
  }
  const exportAllData = () => ({ ...finance.exportData(), pgblPlans: Object.values(pgbl.plans) })
  const importAllData = async (data) => {
    // Sem pgblPlans no arquivo (backup anterior ao PGBL ou dados de exemplo),
    // reenvia os planos atuais: a RPC faz replace total e os apagaria.
    const ok = await finance.importData(data, data?.pgblPlans ?? Object.values(pgbl.plans))
    if (ok) await pgbl.reload()
    return ok
  }

  // Meta de reinvestimento exibida no KPI de poupanca (SummaryCards).
  // Sem useMemo de proposito: sao ~22 categorias e o valor e um numero que
  // alimenta um componente nao memoizado - o hook nao pouparia render nenhum.
  const reinvestmentTargetPercentage = finance.categories
    .filter((category) => category.type === 'reinvested')
    .reduce((sum, category) => sum + (Number(category.targetPercentage) || 0), 0)

  const overview = (
    <div className="stack">
      <Suspense fallback={<ChartFallback height={220} />}>
        <TrendChart
          variant="hero"
          trend={chartMonthly.trend}
          accumulatedValue={chartMonthly.trend.at(-1)?.cumulative ?? monthly.summary.balance}
          monthlyValue={monthly.summary.balance}
        />
      </Suspense>
      <SummaryCards
        summary={monthly.summary}
        change={monthly.change}
        accumulatedPatrimony={monthly.accumulatedPatrimony}
        reinvestmentTargetPercentage={reinvestmentTargetPercentage}
      />
      <div className="dashboard-category-row">
        <Suspense fallback={<ChartFallback height={240} />}>
          {/* REQ 6: metas percentuais somam 100% entre despesas e reinvestimentos,
              então o gráfico compara realizado × esperado sobre as duas juntas. */}
          <CategoryChart
            byCategory={{ ...monthly.byCategory, ...monthly.byCategoryReinvested }}
            categories={finance.categories}
            total={monthly.summary.expense + monthly.summary.reinvested}
            incomeTotal={monthly.summary.income}
          />
        </Suspense>
      </div>
      <div className="dashboard-monthly-row">
        <Suspense fallback={<ChartFallback height={280} />}>
          <MonthlyChart transactions={finance.transactions} monthKey={monthly.monthKey} categories={finance.categories} />
        </Suspense>
      </div>
      <div className="grid-2 dashboard-grid dashboard-bottom-panels">
        <Insights {...insightProps} />
        <FixedExpenses occurrences={monthly.occurrences} categories={finance.categories} onTogglePaid={finance.togglePaid} />
      </div>
    </div>
  )

  if (finance.loading) {
    return <FinanceLoadingScreen />
  }

  const page = PAGE_META[activeTab] || PAGE_META.overview

  return (
    <div className="app-shell finance-content-enter">
      {finance.isDeletingGoal && (
        <div className="sync-overlay" role="status" aria-live="assertive" aria-label="Atualizando metas">
          <div className="sync-overlay-card">
            <div className="spinner" />
            <strong>Excluindo meta...</strong>
            <span>Enviando a solicitacao de exclusao com seguranca.</span>
          </div>
        </div>
      )}
      <Sidebar active={activeTab} onChange={setActiveTab} badges={{ transactions: pendingCount }} />

      <div className="app-main">
        <Topbar
          monthKey={monthKey}
          onMonthChange={(update) => startMonthTransition(() => setMonthKey(update))}
          isMonthPending={isMonthPending}
          theme={theme}
          onToggleTheme={toggleTheme}
          privacyVisible={privacyVisible}
          onTogglePrivacy={togglePrivacy}
          user={auth.user}
          onSignOut={() => auth.signOut()}
          search={search}
          onSearch={handleSearch}
          pending={pending}
          pendingTotal={pendingTotal}
          onOpenPending={(occurrence) => { setNotificationFocus(occurrence); setActiveTab('transactions') }}
          showMonthNav={!['budget', 'goals', 'pgbl'].includes(activeTab)}
        />

        <main className="container main-content">
          {/* Sem sufixo colado aqui: o banner nao sabe se houve recarga, e um
              " Os dados foram recarregados do servidor." fixo mentia em toda
              mensagem que retorna antes de qualquer leitura - validacao local de
              categoria (useFinanceOperations.js:88), 'Backup invalido.' (useFinanceDataManagement.js:19),
              sessao expirada na importacao (:23), falha ao excluir meta (useGoalOperations.js:74).
              Quem reporta sabe se recarregou: o sufixo sai de reportError
              (useSupabaseFinance.js:46), que desde o B78 recebe `reloaded` em
              tres estados - a promessa vem do retorno do `load`, e a recarga que
              falha avisa em vez de calar. */}
          {finance.error && (
            <div className="notice danger" role="alert" style={{ marginBottom: 20 }}>
              {finance.error}
            </div>
          )}

          <div className="page-head">
            <div style={{ minWidth: 0 }}>
              <h1 className="page-title">{page.title}</h1>
              <p className="page-sub">
                {activeTab === 'overview' ? `${page.sub} • ${monthLabel(monthKey)}` : page.sub}
              </p>
            </div>
            {!['budget', 'goals', 'pgbl'].includes(activeTab) && (
              <button type="button" className="btn btn-primary add-main" onClick={openNew}>
                <Plus size={16} strokeWidth={2.2} />
                Novo lançamento
              </button>
            )}
          </div>

          {activeTab === 'overview' && overview}
          {activeTab === 'transactions' && (
            <TransactionList
              occurrences={monthly.occurrences}
              categories={finance.categories}
              monthKey={monthKey}
              onEdit={openEdit}
              onDelete={deleteTransaction}
              onDuplicate={finance.duplicateTransaction}
              onTogglePaid={finance.togglePaid}
              onNew={openNew}
              onExportCSV={(rows) => exportCSV(rows, finance.categories, `lancamentos-${monthKey}.csv`)}
              search={search}
              onSearchChange={setSearch}
              focusOccurrence={notificationFocus}
              onFocusDone={() => { setNotificationFocus(null); setActiveTab('overview') }}
            />
          )}
          {activeTab === 'budget' && (
            <BudgetPanel budgets={finance.budgets} byCategory={monthly.byCategory} categories={finance.categories} monthKey={monthKey} onSetBudget={finance.setBudget} />
          )}
          {activeTab === 'goals' && (
            <GoalsPanel
              goals={finance.goals}
              reverseHistory={finance.reverseGoalHistory}
              reverseContributions={finance.reverseGoalContributions}
              standardContributions={finance.standardGoalContributions}
              onAdd={finance.addGoal}
              onAddReverse={finance.addReverseGoal}
              onAddReverseContribution={finance.addReverseGoalContribution}
              onUpdateReverseContribution={finance.updateReverseGoalContribution}
              onAddStandardContribution={finance.addStandardGoalContribution}
              onUpdateStandardContribution={finance.updateStandardGoalContribution}
              onUpdate={finance.updateGoal}
              onUpdateReverse={finance.updateReverseGoal}
              onDelete={finance.deleteGoal}
              isDeleting={finance.isDeletingGoal}
            />
          )}
          {activeTab === 'pgbl' && <PGBLPanel pgbl={pgbl} />}
          {activeTab === 'categories' && (
            <CategoryManager categories={finance.categories} transactions={finance.transactions} onAdd={finance.addCategory} onUpdate={finance.updateCategory} onDelete={finance.deleteCategory} />
          )}
          {activeTab === 'icons' && <IconManager />}
          {activeTab === 'security' && <SecurityPanel />}
          {activeTab === 'settings' && (
            <SettingsPanel
              theme={theme}
              transactionCount={finance.transactions.length}
              categoryCount={finance.categories.length}
              goalCount={finance.goals.length}
              onToggleTheme={toggleTheme}
              onExportJSON={() => exportJSON(exportAllData())}
              onImport={importAllData}
              onLoadSample={() => importAllData(buildSampleData(finance.categories))}
              onClearAll={finance.clearAll}
              reverseGoalRetentionMonths={finance.reverseGoalRetentionMonths}
              reverseGoalRetentionLoaded={finance.reverseGoalRetentionLoaded}
              onSetReverseGoalRetention={finance.setReverseGoalRetention}
              transactionFormFields={finance.transactionFormFields}
              onTransactionFormFieldsChange={finance.setTransactionFormFields}
            />
          )}

        </main>
      </div>

      <BottomNav
        active={activeTab}
        onChange={setActiveTab}
        badges={{ transactions: pendingCount }}
        onOpenNew={activeTab === 'pgbl' ? undefined : openNew}
      />

      <TransactionForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSubmit={saveTransaction}
        initial={editing}
        categories={finance.categories}
        transactions={finance.transactions}
        defaultDate={isoDateInMonth(monthKey, new Date().getDate())}
        fieldVisibility={finance.transactionFormFields}
      />
    </div>
  )
}
