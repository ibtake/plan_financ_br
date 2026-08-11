import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ChartInfoTooltip from './ChartInfoTooltip.jsx'
import { formatCurrency, formatPercent, monthLabel, monthLabelShort, percentChange } from '../utils/format.js'

function TooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  const change = item.previousCumulative === null ? null : percentChange(item.cumulative, item.previousCumulative)
  return <ChartInfoTooltip title={item.tooltipTitle} value={formatCurrency(item.cumulative)} color={item.cumulative >= 0 ? 'var(--position-positive)' : 'var(--position-negative)'} changeLabel={change === null ? null : String(change >= 0 ? '↑' : '↓') + ' ' + formatPercent(Math.abs(change), 0)} changeTone={change === null ? null : change >= 0 ? 'positive' : 'negative'} detail={`Saldo do mês: ${formatCurrency(item.balance)}`} />
}

export default function TrendChart({ trend, variant = 'card', accumulatedValue = 0, monthlyValue = 0 }) {
  const [tooltipPosition, setTooltipPosition] = useState(null)
  const data = trend
  const isHero = variant === 'hero'
  const hasData = data.some((d) => d.income > 0 || d.expense > 0 || d.reinvested > 0)
  const chartData = data.map((item, index) => ({
    ...item,
    tooltipTitle: monthLabel(item.key),
    previousCumulative: index === 0 ? null : data[index - 1].cumulative,
    positiveCumulative: Math.max(item.cumulative, 0),
    negativeCumulative: Math.min(item.cumulative, 0),
  }))

  return (
    <div className={isHero ? 'balance-hero' : 'card'}>
      <div className="card-head">
        <div>
          <div className={isHero ? 'balance-hero-label' : 'card-title'}>
            {isHero ? 'Posi\u00e7\u00e3o atual' : 'Saldo acumulado'}
          </div>
          {isHero && (
            <>
              <div className={`balance-hero-value${accumulatedValue < 0 ? ' is-negative' : accumulatedValue > 0 ? ' is-positive' : ''}`}>{formatCurrency(accumulatedValue)}</div>
              <div className={`balance-hero-change${monthlyValue < 0 ? ' is-negative' : ''}`}>
                {formatCurrency(monthlyValue)} neste mês
              </div>
            </>
          )}
          <div className="card-sub">{'Quanto voc\u00ea somou (ou perdeu) ao longo do per\u00edodo'}</div>
        </div>
      </div>

      {hasData ? (
        <div className={isHero ? 'chart-wrap balance-hero-chart' : 'chart-wrap'} style={{ height: isHero ? 190 : 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} onClick={(state) => {
              if (state?.chartX == null || state?.chartY == null) return
              const x = state.chartWidth ? Math.max(80, Math.min(state.chartX, state.chartWidth - 80)) : state.chartX
              setTooltipPosition({
                x,
                y: state.chartY,
                placement: state.chartY < 82 ? 'below' : 'above',
              })
            }} onMouseLeave={() => setTooltipPosition(null)}>
              <YAxis hide domain={['auto', 'auto']} />
              <XAxis
                dataKey="key"
                tickFormatter={(key) => monthLabelShort(key).split('/')[0]}
                interval={0}
                tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <Tooltip active={Boolean(tooltipPosition)} content={<TooltipContent />} position={tooltipPosition || undefined} wrapperClassName={tooltipPosition ? `tooltip-${tooltipPosition.placement}` : ''} offset={0} cursor={false} />
              <Area
                type="monotone"
                dataKey="positiveCumulative"
                stroke="none"
                fill="var(--trend-income-fill)"
                baseValue={0}
                isAnimationActive={false}
              />
              <ReferenceLine y={0} stroke="var(--text-muted)" strokeWidth={1.5} ifOverflow="extendDomain" />
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
