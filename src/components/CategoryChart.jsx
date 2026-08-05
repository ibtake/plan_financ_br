import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import AppIcon from './AppIcon.jsx'
import { getCategory } from '../utils/categories.js'
import { formatCurrency, formatPercent } from '../utils/format.js'

function TooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">
        <AppIcon emoji={item.icon} /> {item.name}
      </div>
      <div className="chart-tooltip-row">
        <span className="chart-dot" style={{ background: item.color }} />
        <strong>{formatCurrency(item.value)}</strong>
        <span>({formatPercent(item.share, 1)})</span>
      </div>
    </div>
  )
}

export default function CategoryChart({ byCategory, categories, total }) {
  const data = useMemo(() => {
    const entries = Object.entries(byCategory)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])

    return entries.map(([id, value]) => {
      const cat = getCategory(categories, id)
      return {
        id,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        value,
        share: total > 0 ? (value / total) * 100 : 0,
      }
    })
  }, [byCategory, categories, total])

  if (!data.length) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Despesas por categoria</div>
            <div className="card-sub">Distribuição dos gastos do mês</div>
          </div>
        </div>
        <div className="empty">
          <div className="empty-icon">🥧</div>
          <div className="empty-title">Nenhuma despesa neste mês</div>
          <div className="text-sm">Adicione lançamentos para ver o gráfico.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Despesas por categoria</div>
          <div className="card-sub">Total de {formatCurrency(total)} no mês</div>
        </div>
      </div>

      <div className="chart-wrap" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={62}
              outerRadius={98}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.id} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<TooltipContent />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="legend">
        {data.slice(0, 6).map((item) => (
          <div key={item.id} className="legend-item">
            <span className="chart-dot" style={{ background: item.color }} />
            <span className="grow">
              <AppIcon emoji={item.icon} /> {item.name}
            </span>
            <span className="text-muted text-xs">{formatPercent(item.share)}</span>
            <span className="legend-value mono">{formatCurrency(item.value)}</span>
          </div>
        ))}
        {data.length > 6 && (
          <div className="legend-item text-muted text-xs">
            + {data.length - 6} outras categorias
          </div>
        )}
      </div>
    </div>
  )
}
