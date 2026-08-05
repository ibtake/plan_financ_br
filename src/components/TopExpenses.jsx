import { useMemo } from 'react'
import { TrendingDown } from 'lucide-react'
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
        <div style={{ minWidth: 0 }}>
          <div className="card-title">Maiores despesas</div>
          <div className="card-sub">Top 5 gastos do mês</div>
        </div>
      </div>

      {top.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <TrendingDown size={22} strokeWidth={1.6} />
          </div>
          <div className="empty-title">Nenhuma despesa registrada</div>
        </div>
      ) : (
        <div className="tx-list">
          {top.map((tx, index) => {
            const cat = getCategory(categories, tx.categoryId)
            const share = total > 0 ? (tx.amount / total) * 100 : 0
            return (
              <div className="tx" key={tx.id}>
                <div className="tx-rank" aria-hidden="true">{index + 1}</div>
                <div
                  className="tx-icon"
                  style={{ background: `${cat.color}22`, color: cat.color }}
                  title={cat.name}
                >
                  <AppIcon emoji={cat.icon} />
                </div>
                <div className="tx-main">
                  <div className="tx-desc">{tx.description}</div>
                  <div className="tx-meta">
                    <span>{formatDate(tx.date)}</span>
                    <span aria-hidden="true">•</span>
                    <span>{cat.name}</span>
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
