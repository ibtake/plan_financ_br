import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { PieChart as PieChartIcon } from 'lucide-react'
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
      {item.target > 0 && (
        <div className="chart-tooltip-row text-muted">
          <span>
            Esperado {formatCurrency(item.expected)} ({formatPercent(item.target, 1)})
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Distribuição das saídas do mês por categoria.
 *
 * REQ 6: cada categoria pode ter uma meta percentual (`targetPercentage`). O
 * valor Esperado é essa porcentagem aplicada ao total de saídas do mês. Na
 * legenda o Realizado fica em destaque (negrito) e o Esperado em fonte normal,
 * com cor sutil — em telas pequenas as duas informações ficam empilhadas na
 * mesma linha, sem coluna extra.
 */
export default function CategoryChart({ byCategory, categories, total }) {
  const data = useMemo(() => {
    const entries = Object.entries(byCategory)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])

    return entries.map(([id, value]) => {
      const cat = getCategory(categories, id)
      const target = Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0))
      return {
        id,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        value,
        share: total > 0 ? (value / total) * 100 : 0,
        target,
        expected: (target / 100) * total,
      }
    })
  }, [byCategory, categories, total])

  const hasTargets = data.some((item) => item.target > 0)

  if (!data.length) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Saídas por categoria</div>
            <div className="card-sub">Distribuição dos gastos e reinvestimentos do mês</div>
          </div>
        </div>
        <div className="empty">
          <div className="empty-icon">
            <PieChartIcon size={22} strokeWidth={1.6} />
          </div>
          <div className="empty-title">Nenhuma saída neste mês</div>
          <div className="text-sm">Adicione lançamentos para ver o gráfico.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Saídas por categoria</div>
          <div className="card-sub">
            Total de {formatCurrency(total)} no mês
            {hasTargets && ' • realizado em destaque, esperado em cinza'}
          </div>
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
            <span className="legend-figures">
              <span className="legend-value mono">{formatCurrency(item.value)}</span>
              {item.target > 0 ? (
                <span
                  className={`legend-expected mono${item.share > item.target ? ' over' : ''}`}
                  title={`Esperado: ${formatPercent(item.target, 1)} do total`}
                >
                  {formatPercent(item.share, 1)} · meta {formatCurrency(item.expected)}
                </span>
              ) : (
                <span className="legend-expected mono">{formatPercent(item.share, 1)}</span>
              )}
            </span>
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
