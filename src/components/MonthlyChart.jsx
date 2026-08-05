import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCompact, formatCurrency, monthLabel, monthLabelShort } from '../utils/format.js'

function TooltipContent({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{monthLabel(label)}</div>
      {payload.map((p) => (
        <div className="chart-tooltip-row" key={p.dataKey}>
          <span className="chart-dot" style={{ background: p.fill || p.color }} />
          {p.name}: <strong>{formatCurrency(p.value)}</strong>
        </div>
      ))}
    </div>
  )
}

export default function MonthlyChart({ history }) {
  const data = useMemo(
    () =>
      history.map((h) => ({
        key: h.key,
        label: monthLabelShort(h.key),
        income: h.income,
        expense: h.expense,
      })),
    [history],
  )

  const hasData = data.some((d) => d.income > 0 || d.expense > 0)

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Receitas × Despesas</div>
          <div className="card-sub">Evolução dos últimos {history.length} meses</div>
        </div>
      </div>

      {hasData ? (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="key"
                tickFormatter={monthLabelShort}
                tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatCompact}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip content={<TooltipContent />} cursor={{ fill: 'var(--surface-2)' }} />
              <Legend
                wrapperStyle={{ fontSize: 13, paddingTop: 8 }}
                formatter={(v) => <span style={{ color: 'var(--text-soft)' }}>{v}</span>}
              />
              <Bar
                dataKey="income"
                name="Receitas"
                fill="var(--income)"
                radius={[5, 5, 0, 0]}
                maxBarSize={30}
              />
              <Bar
                dataKey="expense"
                name="Despesas"
                fill="var(--expense)"
                radius={[5, 5, 0, 0]}
                maxBarSize={30}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon">
            <BarChart3 size={22} strokeWidth={1.6} />
          </div>
          <div className="empty-title">Sem histórico ainda</div>
          <div className="text-sm">Cadastre lançamentos para acompanhar a evolução.</div>
        </div>
      )}
    </div>
  )
}
