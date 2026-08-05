import { TrendingUp, TrendingDown, Minus, ArrowDownToLine, ArrowUpFromLine, Wallet, AlertTriangle, PiggyBank } from 'lucide-react'
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
 * Grid de 4 KPIs: receitas, despesas, saldo e taxa de poupança.
 *
 * Recebe dados consolidados do mês (`summary`) e as variações em relação
 * ao mês anterior (`change`).
 */
export default function SummaryCards({ summary, change }) {
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

      <KPI
        icon={PiggyBank}
        label="Taxa de poupança"
        value={formatPercent(savingsRate, 1)}
        accentColor={savingsRate >= 20 ? 'var(--income)' : savingsRate >= 0 ? 'var(--warning)' : 'var(--expense)'}
        accentSoft={savingsRate >= 20 ? 'var(--income-soft)' : savingsRate >= 0 ? 'var(--warning-soft)' : 'var(--expense-soft)'}
      >
        <span>
          {savingsRate >= 20
            ? 'Excelente!'
            : savingsRate >= 10
              ? 'Bom, pode melhorar'
              : savingsRate >= 0
                ? 'Abaixo do ideal'
                : 'Gastando mais que ganha'}
        </span>
      </KPI>
    </div>
  )
}
