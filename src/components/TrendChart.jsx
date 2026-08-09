import { TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency, monthLabel, monthLabelShort } from '../utils/format.js'

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
        {'No \u00eas: '}<strong>{formatCurrency(item.balance)}</strong>
      </div>
    </div>
  )
}

export default function TrendChart({ trend, variant = 'card', value = 0, changeAmount = null }) {
  const data = trend
  const isHero = variant === 'hero'
  const hasData = data.some((d) => d.income > 0 || d.expense > 0 || d.reinvested > 0)
  const chartData = data.map((item) => ({
    ...item,
    positiveCumulative: Math.max(item.cumulative, 0),
    negativeCumulative: Math.min(item.cumulative, 0),
  }))

  return (
    <div className={isHero ? 'balance-hero' : 'card'}>
      <div className="card-head">
        <div>
          <div className={isHero ? 'balance-hero-label' : 'card-title'}>
            {isHero ? 'Saldo do \u00eas' : 'Saldo acumulado'}
          </div>
          {isHero && (
            <>
              <div className="balance-hero-value">{formatCurrency(value)}</div>
              <div className={`balance-hero-change${changeAmount !== null && changeAmount < 0 ? ' is-negative' : ''}`}>
                {changeAmount === null
                  ? 'Sem compara\u00e7\u00e3o'
                  : `${changeAmount >= 0 ? '\u25b2' : '\u25bc'} ${formatCurrency(Math.abs(changeAmount))} vs. m\u00eas anterior`}
              </div>
            </>
          )}
          <div className="card-sub">{'Quanto voc\u00ea somou (ou perdeu) ao longo do per\u00edodo'}</div>
        </div>
      </div>

      {hasData ? (
        <div className={isHero ? 'chart-wrap balance-hero-chart' : 'chart-wrap'} style={{ height: isHero ? 190 : 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <YAxis hide domain={['auto', 'auto']} />
              <XAxis
                dataKey="key"
                tickFormatter={monthLabelShort}
                tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <Tooltip content={<TooltipContent />} />
              <Area
                type="monotone"
                dataKey="positiveCumulative"
                stroke="none"
                fill="var(--trend-income-fill)"
                baseValue={0}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="negativeCumulative"
                stroke="none"
                fill="var(--trend-expense-fill)"
                baseValue={0}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke="var(--primary)"
                strokeWidth={2.5}
                fill="none"
                dot={false}
                activeDot={false}
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
