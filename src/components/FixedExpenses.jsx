import { useMemo } from 'react'
import { AlertTriangle, Check, ReceiptText } from 'lucide-react'
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
        <div style={{ minWidth: 0 }}>
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
          <div className="empty-icon">
            <ReceiptText size={22} strokeWidth={1.6} />
          </div>
          <div className="empty-title">Nenhuma conta fixa ou pendente</div>
          <div className="text-sm">
            Marque um lançamento como recorrente para acompanhá-lo aqui.
          </div>
        </div>
      ) : (
        <div className="tx-list">
          {items.map((tx) => {
            const cat = getCategory(categories, tx.categoryId)
            const days = daysUntil(tx.date)
            const overdue = !tx.paid && days < 0
            const soon = !tx.paid && days >= 0 && days <= 5

            return (
              <div className="tx" key={tx.id}>
                <button
                  type="button"
                  className="tx-icon tx-icon-btn"
                  onClick={() => onTogglePaid(tx)}
                  title={tx.paid ? 'Marcar como pendente' : 'Marcar como pago'}
                  aria-label={tx.paid ? 'Marcar como pendente' : 'Marcar como pago'}
                  style={{
                    background: tx.paid ? 'var(--income-soft)' : `${cat.color}22`,
                    color: tx.paid ? 'var(--income)' : cat.color,
                  }}
                >
                  {tx.paid ? <Check size={17} strokeWidth={2.6} /> : <AppIcon emoji={cat.icon} />}
                </button>

                <div className="tx-main">
                  <div className="tx-desc" style={{ opacity: tx.paid ? 0.6 : 1 }}>
                    {tx.description}
                  </div>
                  <div className="tx-meta">
                    <span>vence {formatDate(tx.date)}</span>
                    {overdue && (
                      <span className="chip expense">
                        <AlertTriangle size={11} strokeWidth={2.2} />
                        atrasada
                      </span>
                    )}
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
