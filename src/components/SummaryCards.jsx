import AppIcon from './AppIcon.jsx'
import { formatCurrency, formatPercent } from '../utils/format.js'

function Delta({ value, invert = false }) {
  const rounded = Math.round(value)
  if (!Number.isFinite(rounded) || rounded === 0) {
    return <span className="delta flat">— estável</span>
  }
  const positive = rounded > 0
  // Para despesas, subir é ruim (invert)
  const good = invert ? !positive : positive
  return (
    <span className={`delta ${good ? 'up' : 'down'}`}>
      {positive ? '▲' : '▼'} {formatPercent(Math.abs(rounded))}
    </span>
  )
}

function Card({ accent, icon, label, value, children }) {
  return (
    <div className="summary-card" style={{ '--accent': accent }}>
      <div className="summary-label">
        <AppIcon emoji={icon} />
        {label}
      </div>
      <div className="summary-value">{value}</div>
      <div className="summary-foot">{children}</div>
    </div>
  )
}

export default function SummaryCards({ summary, change }) {
  const { income, expense, balance, savingsRate, pendingExpense } = summary

  return (
    <div className="grid-4">
      <Card
        accent="var(--income)"
        icon="📥"
        label="Receitas"
        value={formatCurrency(income)}
      >
        <Delta value={change.income} />
        <span>vs. mês anterior</span>
      </Card>

      <Card
        accent="var(--expense)"
        icon="📤"
        label="Despesas"
        value={formatCurrency(expense)}
      >
        <Delta value={change.expense} invert />
        <span>vs. mês anterior</span>
      </Card>

      <Card
        accent={balance >= 0 ? 'var(--primary)' : 'var(--expense)'}
        icon={balance >= 0 ? '💙' : '⚠️'}
        label="Saldo do mês"
        value={formatCurrency(balance)}
      >
        {pendingExpense > 0 ? (
          <span className="chip warning">
            {formatCurrency(pendingExpense)} a pagar
          </span>
        ) : (
          <span>{balance >= 0 ? 'Você fechou no azul' : 'Atenção: saldo negativo'}</span>
        )}
      </Card>

      <Card
        accent={savingsRate >= 20 ? 'var(--income)' : savingsRate >= 0 ? 'var(--warning)' : 'var(--expense)'}
        icon="🐖"
        label="Taxa de poupança"
        value={formatPercent(savingsRate, 1)}
      >
        <span>
          {savingsRate >= 20
            ? 'Excelente!'
            : savingsRate >= 10
              ? 'Bom, dá pra melhorar'
              : savingsRate >= 0
                ? 'Abaixo do ideal (20%)'
                : 'Gastando mais que ganha'}
        </span>
      </Card>
    </div>
  )
}
