import { TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCompact, formatCurrency, monthLabel, monthLabelShort } from '../utils/format.js'

function TooltipContent({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{monthLabel(label)}</div>
      <div className="chart-tooltip-row">
        <span className="chart-dot" style={{ background: 'var(--primary)' }} />
        Acumulado: <strong>{formatCurrency(item.cumulative)}</strong>
      </div>
      <div className="chart-tooltip-row">
        <span className="chart-dot" style={{ background: 'var(--text-muted)' }} />
        No mês: <strong>{formatCurrency(item.balance)}</strong>
      </div>
    </div>
  )
}

export default function TrendChart({ trend }) {
  const data = trend
  const hasData = data.some((d) => d.income > 0 || d.expense > 0 || d.reinvested > 0)

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Saldo acumulado</div>
          <div className="card-sub">Quanto você somou (ou perdeu) ao longo do período</div>
        </div>
      </div>

      {hasData ? (
        <div className="chart-wrap" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
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
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Tooltip content={<TooltipContent />} />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke="var(--primary)"
                strokeWidth={2.5}
                fill="url(#trendFill)"
                dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="empty">
          <div className="empty-icon">
            <TrendingUp size={22} strokeWidth={1.6} />
          </div>
          <div className="empty-title">Sem dados suficientes</div>
        </div>
      )}
    </div>
  )
}
