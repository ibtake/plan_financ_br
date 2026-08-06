import { TrendingUp, TrendingDown, Minus, ArrowDownToLine, ArrowUpFromLine, Wallet, AlertTriangle, Landmark } from 'lucide-react'
import { formatCurrency, formatPercent } from '../utils/format.js'

/**
 * Indicador de variação mensal.
 *
 * Para despesas, subir é negativo (invert=true).
 */
function Delta({ value, invert = false }) {
  const rounded = Math.round(value)
  if (!Number.isFinite(rounded) || rounded === 0) {
    return (
      <span className="delta flat">
        <Minus size={12} strokeWidth={2.5} />
        estável
      </span>
    )
  }
  const positive = rounded > 0
  const good = invert ? !positive : positive
  return (
    <span className={`delta ${good ? 'up' : 'down'}`}>
      {positive ? <TrendingUp size={12} strokeWidth={2.5} /> : <TrendingDown size={12} strokeWidth={2.5} />}
      {formatPercent(Math.abs(rounded))}
    </span>
  )
}

/**
 * Card KPI individual.
 *
 * Estrutura: ícone, label, valor principal, rodapé com delta e texto.
 */
function KPI({ icon: Icon, label, value, accentColor, accentSoft, children }) {
  return (
    <div className="kpi" style={{ '--accent': accentColor, '--accent-soft': accentSoft }}>
      <div className="kpi-top">
        <div className="kpi-label">{label}</div>
        <div className="kpi-icon">
          <Icon size={17} strokeWidth={2} />
        </div>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{children}</div>
    </div>
  )
}

/**
 * Grid de KPIs: receitas, despesas, saldo, patrimônio e taxa de poupança.
 *
 * Recebe dados consolidados do mês (`summary`), as variações em relação
 * ao mês anterior (`change`) e o patrimônio acumulado nos últimos meses
 * (`accumulatedPatrimony`, somatório das despesas reinvestidas).
 */
export default function SummaryCards({ summary, change, accumulatedPatrimony = 0, reinvestmentTargetPercentage = 0 }) {
  const { income, expense, balance, savingsRate, pendingExpense } = summary

  return (
    <div className="grid-4">
      <KPI
        icon={ArrowDownToLine}
        label="Receitas"
        value={formatCurrency(income)}
        accentColor="var(--income)"
        accentSoft="var(--income-soft)"
      >
        <Delta value={change.income} />
        <span>vs. mês anterior</span>
      </KPI>

      <KPI
        icon={ArrowUpFromLine}
        label="Despesas"
        value={formatCurrency(expense)}
        accentColor="var(--expense)"
        accentSoft="var(--expense-soft)"
      >
        <Delta value={change.expense} invert />
        <span>vs. mês anterior</span>
      </KPI>

      <KPI
        icon={balance >= 0 ? Wallet : AlertTriangle}
        label="Saldo do mês"
        value={formatCurrency(balance)}
        accentColor={balance >= 0 ? 'var(--primary)' : 'var(--expense)'}
        accentSoft={balance >= 0 ? 'var(--primary-soft)' : 'var(--expense-soft)'}
      >
        {pendingExpense > 0 ? (
          <>
            <span className="chip warning">{formatCurrency(pendingExpense)}</span>
            <span>a pagar</span>
          </>
        ) : (
          <span>{balance >= 0 ? 'Você fechou no azul' : 'Atenção: saldo negativo'}</span>
        )}
      </KPI>

      {/* REQ 3: o reinvestimento sai da liquidez, mas fica acumulado aqui */}
      <KPI
        icon={Landmark}
        label="Patrimônio acumulado"
        value={formatCurrency(accumulatedPatrimony)}
        accentColor="var(--reinvest)"
        accentSoft="var(--reinvest-soft)"
      >
        <span className="kpi-savings-summary">
          {formatPercent(savingsRate, 1)} poupado no mês | Meta {formatPercent(reinvestmentTargetPercentage, 1)}
        </span>
      </KPI>
    </div>
  )
}
