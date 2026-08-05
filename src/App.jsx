import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Header from './components/Header.jsx'
import Tabs from './components/Tabs.jsx'
import SummaryCards from './components/SummaryCards.jsx'
import TransactionForm from './components/TransactionForm.jsx'
import TransactionList from './components/TransactionList.jsx'
import BudgetPanel from './components/BudgetPanel.jsx'
import GoalsPanel from './components/GoalsPanel.jsx'
import Insights from './components/Insights.jsx'
import TopExpenses from './components/TopExpenses.jsx'
import FixedExpenses from './components/FixedExpenses.jsx'
import CategoryManager from './components/CategoryManager.jsx'
import IconManager from './components/IconManager.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import SecurityPanel from './components/SecurityPanel.jsx'
import AuthScreen from './components/auth/AuthScreen.jsx'
import RequiredPasswordChange from './components/auth/RequiredPasswordChange.jsx'
import { useAuth } from './contexts/AuthContext.jsx'
import { useMonthlyData } from './hooks/useFinance.js'
import { useSupabaseFinance } from './hooks/useSupabaseFinance.js'
import { currentMonthKey, isoDateInMonth } from './utils/format.js'
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

export default function App() {
  const auth = useAuth()

  if (auth.loading) {
    return <div className="app-loading"><div className="spinner" /><span>Verificando sessão...</span></div>
  }

  if (!auth.session || auth.mfaStage === 'required') return <AuthScreen />
  if (auth.user?.app_metadata?.must_change_password === true) return <RequiredPasswordChange />

  return <AuthenticatedApp />
}

function AuthenticatedApp() {
  const auth = useAuth()
  const finance = useSupabaseFinance()
  const [monthKey, setMonthKey] = useState(currentMonthKey())
  const [activeTab, setActiveTab] = useState('overview')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const monthly = useMonthlyData(finance.transactions, monthKey)

  useEffect(() => {
    document.documentElement.dataset.theme = finance.theme
    document.documentElement.style.colorScheme = finance.theme
  }, [finance.theme])

  const toggleTheme = () => finance.setTheme((value) => (value === 'dark' ? 'light' : 'dark'))
  const openNew = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (occurrence) => { setEditing(occurrence); setFormOpen(true) }

  const saveTransaction = (data) => {
    if (editing) finance.updateTransaction(editing.sourceId || editing.id, data)
    else finance.addTransaction(data)
  }

  const deleteTransaction = (occurrence) => {
    const scope = occurrence.sourceId || String(occurrence.id).includes('#')
      ? ' Esta ação exclui toda a série ou todas as parcelas.'
      : ''
    if (window.confirm(`Excluir “${occurrence.description}”?${scope}`)) {
      finance.deleteTransaction(occurrence.sourceId || occurrence.id)
    }
  }

  const pendingCount = useMemo(
    () => monthly.occurrences.filter((item) => !item.paid).length,
    [monthly.occurrences],
  )

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

  const overview = (
    <div className="stack">
      <SummaryCards summary={monthly.summary} change={monthly.change} />
      <div className="grid-2 dashboard-grid">
        <Suspense fallback={<ChartFallback height={240} />}>
          <CategoryChart byCategory={monthly.byCategory} categories={finance.categories} total={monthly.summary.expense} />
        </Suspense>
        <Suspense fallback={<ChartFallback height={280} />}>
          <MonthlyChart history={monthly.history} />
        </Suspense>
      </div>
      <div className="grid-2 dashboard-grid">
        <Suspense fallback={<ChartFallback height={240} />}>
          <TrendChart trend={monthly.trend} />
        </Suspense>
        <Insights {...insightProps} />
      </div>
      <div className="grid-2 dashboard-grid">
        <TopExpenses occurrences={monthly.occurrences} categories={finance.categories} total={monthly.summary.expense} />
        <FixedExpenses occurrences={monthly.occurrences} categories={finance.categories} onTogglePaid={finance.togglePaid} />
      </div>
    </div>
  )

  if (finance.loading) {
    return <div className="app-loading"><div className="spinner" /><span>Carregando seus dados...</span></div>
  }

  return (
    <div className="app-shell">
      <Header monthKey={monthKey} onMonthChange={setMonthKey} theme={finance.theme} onToggleTheme={toggleTheme} user={auth.user} onSignOut={() => auth.signOut()} />
      <main className="container main-content">
        {finance.error && <div className="notice danger" style={{ marginBottom: 14 }}>{finance.error} Os dados foram recarregados do servidor.</div>}
        <div className="page-toolbar">
          <Tabs active={activeTab} onChange={setActiveTab} badges={{ transactions: pendingCount }} />
          <button className="btn btn-primary add-main" onClick={openNew}>➕ Novo lançamento</button>
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
          />
        )}
        {activeTab === 'budget' && (
          <BudgetPanel budgets={finance.budgets} byCategory={monthly.byCategory} categories={finance.categories} monthKey={monthKey} onSetBudget={finance.setBudget} />
        )}
        {activeTab === 'goals' && (
          <GoalsPanel goals={finance.goals} onAdd={finance.addGoal} onUpdate={finance.updateGoal} onDelete={finance.deleteGoal} />
        )}
        {activeTab === 'categories' && (
          <CategoryManager categories={finance.categories} transactions={finance.transactions} onAdd={finance.addCategory} onUpdate={finance.updateCategory} onDelete={finance.deleteCategory} />
        )}
        {activeTab === 'icons' && <IconManager />}
        {activeTab === 'security' && <SecurityPanel />}
        {activeTab === 'settings' && (
          <SettingsPanel
            theme={finance.theme}
            transactionCount={finance.transactions.length}
            categoryCount={finance.categories.length}
            goalCount={finance.goals.length}
            onToggleTheme={toggleTheme}
            onExportJSON={() => exportJSON(finance.exportData())}
            onImport={finance.importData}
            onLoadSample={() => finance.importData(buildSampleData())}
            onClearAll={finance.clearAll}
          />
        )}
      </main>

      <TransactionForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        onSubmit={saveTransaction}
        initial={editing}
        categories={finance.categories}
        defaultDate={isoDateInMonth(monthKey, new Date().getDate())}
      />
      <footer className="footer">Planejador Financeiro • Dados privados e isolados por conta</footer>
    </div>
  )
}