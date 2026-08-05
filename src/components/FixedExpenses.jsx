import { useMemo } from 'react'
import AppIcon from './AppIcon.jsx'
import { getCategory } from '../utils/categories.js'
import { isRecurring } from '../utils/recurrence.js'
import { daysUntil, formatCurrency, formatDate } from '../utils/format.js'

export default function FixedExpenses({ occurrences, categories, onTogglePaid }) {
  const items = useMemo(
    () =>
      occurrences
        .filter((t) => t.type === 'expense' && (isRecurring(t) || !t.paid))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [occurrences],
  )

  const total = items.reduce((s, t) => s + t.amount, 0)
  const pending = items.filter((t) => !t.paid)
  const pendingTotal = pending.reduce((s, t) => s + t.amount, 0)

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Contas do mês</div>
          <div className="card-sub">
            Fixas e pendentes • {formatCurrency(total)} no total
            {pending.length > 0 && (
              <>
                {' '}
                • <span className="text-expense fw-600">{formatCurrency(pendingTotal)} a pagar</span>
              </>
            )}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🧾</div>
          <div className="empty-title">Nenhuma conta fixa ou pendente</div>
          <div className="text-sm">
            Marque um lançamento como recorrente para acompanhá-lo aqui.
          </div>
        </div>
      ) : (
        <div>
          {items.map((tx) => {
            const cat = getCategory(categories, tx.categoryId)
            const days = daysUntil(tx.date)
            const overdue = !tx.paid && days < 0
            const soon = !tx.paid && days >= 0 && days <= 5

            return (
              <div className="tx" key={tx.id} style={{ padding: '10px 4px' }}>
                <button
                  className="tx-icon"
                  onClick={() => onTogglePaid(tx)}
                  title={tx.paid ? 'Marcar como pendente' : 'Marcar como pago'}
                  style={{
                    background: tx.paid ? 'var(--income-soft)' : `${cat.color}22`,
                    color: tx.paid ? 'var(--income)' : cat.color,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <AppIcon emoji={tx.paid ? '✅' : cat.icon} />
                </button>

                <div className="tx-main">
                  <div className="tx-desc" style={{ opacity: tx.paid ? 0.6 : 1 }}>
                    {tx.description}
                  </div>
                  <div className="tx-meta">
                    <span>vence {formatDate(tx.date)}</span>
                    {overdue && <span className="chip expense">⚠️ atrasada</span>}
                    {soon && (
                      <span className="chip warning">
                        {days === 0 ? 'vence hoje' : `em ${days} ${days === 1 ? 'dia' : 'dias'}`}
                      </span>
                    )}
                    {tx.paid && <span className="chip income">pago</span>}
                  </div>
                </div>

                <div
                  className="tx-amount expense mono"
                  style={{
                    opacity: tx.paid ? 0.5 : 1,
                    textDecoration: tx.paid ? 'line-through' : 'none',
                  }}
                >
                  {formatCurrency(tx.amount)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
