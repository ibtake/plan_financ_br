import { useMemo } from 'react'
import AppIcon from './AppIcon.jsx'
import { getCategory } from '../utils/categories.js'
import { formatCurrency, formatDate, formatPercent } from '../utils/format.js'

export default function TopExpenses({ occurrences, categories, total }) {
  const top = useMemo(
    () =>
      occurrences
        .filter((t) => t.type === 'expense')
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    [occurrences],
  )

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Maiores despesas</div>
          <div className="card-sub">Top 5 gastos do mês</div>
        </div>
      </div>

      {top.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><AppIcon emoji="💸" /></div>
          <div className="empty-title">Nenhuma despesa registrada</div>
        </div>
      ) : (
        <div>
          {top.map((tx, index) => {
            const cat = getCategory(categories, tx.categoryId)
            const share = total > 0 ? (tx.amount / total) * 100 : 0
            const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : cat.icon
            return (
              <div className="tx" key={tx.id} style={{ padding: '10px 4px' }}>
                <div
                  className="tx-icon"
                  style={{ background: `${cat.color}22`, color: cat.color }}
                >
                  <AppIcon emoji={rankEmoji} />
                </div>
                <div className="tx-main">
                  <div className="tx-desc">{tx.description}</div>
                  <div className="tx-meta">
                    <span>{formatDate(tx.date)}</span>
                    <span>•</span>
                    <span>
                      <AppIcon emoji={cat.icon} /> {cat.name}
                    </span>
                    <span className="chip">{formatPercent(share)} do mês</span>
                  </div>
                </div>
                <div className="tx-amount expense mono">{formatCurrency(tx.amount)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
