import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, MinusCircle, PieChart as PieChartIcon } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import AppIcon from './AppIcon.jsx'
import { getCategory } from '../utils/categories.js'
import { formatCurrency, formatPercent } from '../utils/format.js'

const SMALL_CATEGORY_SHARE = 5

function getStatus(item) {
  if (item.target <= 0) return { tone: 'neutral', label: 'Sem meta', Icon: MinusCircle }
  const ratio = item.share / item.target
  if (ratio > 1.01) return { tone: 'danger', label: 'Acima da meta', Icon: AlertTriangle }
  if (ratio >= 0.9) return { tone: 'warning', label: 'Atenção', Icon: AlertTriangle }
  return { tone: 'success', label: 'Dentro da meta', Icon: CheckCircle2 }
}

function TooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  const status = getStatus(item)
  return <div className="chart-tooltip category-tooltip"><div className="chart-tooltip-title"><AppIcon emoji={item.icon} /> {item.name}</div><div className="chart-tooltip-row"><span className="chart-dot" style={{ background: item.color }} /><strong>{formatCurrency(item.value)}</strong><span>({formatPercent(item.share, 1)} do total)</span></div><div className="chart-tooltip-row text-muted">Meta {formatPercent(item.target, 1)} · {status.label}</div></div>
}

function Details({ item }) {
  const status = getStatus(item)
  const prefix = item.difference >= 0 ? '+' : '−'
  const differencePercent = item.target > 0 ? item.share - item.target : 0
  return <div className="category-details" id={`category-details-${item.id}`}>
    {item.items?.length > 0 && <div className="grouped-categories" aria-label="Categorias agrupadas">{item.items.map((groupedItem) => <span key={groupedItem.id}><AppIcon emoji={groupedItem.icon} /> {groupedItem.name} ({formatPercent(groupedItem.share, 1)})</span>)}</div>}
    <dl className="category-detail-grid">
      <div><dt>Meta</dt><dd>{formatPercent(item.target, 1)}</dd></div><div><dt>Real</dt><dd>{formatPercent(item.share, 1)}</dd></div>
      <div><dt>Meta em valor</dt><dd>{formatCurrency(item.targetValue)}</dd></div><div><dt>Realizado</dt><dd>{formatCurrency(item.value)}</dd></div>
      <div><dt>Diferença</dt><dd className={status.tone === 'danger' ? 'detail-danger' : ''}>{prefix}{formatCurrency(Math.abs(item.difference))}</dd></div><div><dt>Diferença percentual</dt><dd className={status.tone === 'danger' ? 'detail-danger' : ''}>{prefix}{formatPercent(Math.abs(differencePercent), 1)}</dd></div>
    </dl>
    <div className={`category-status status-${status.tone}`}><status.Icon size={14} aria-hidden="true" /> Status: {status.label}</div>
  </div>
}

/** Apresentação do card: não altera dados nem regras financeiras. */
export default function CategoryChart({ byCategory, categories, total, budgets = {} }) {
  const [selectedId, setSelectedId] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const { data, budgetUsage } = useMemo(() => {
    const rawData = Object.entries(byCategory).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([id, value]) => {
      const cat = getCategory(categories, id)
      const target = Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0))
      const share = total > 0 ? (value / total) * 100 : 0
      const targetValue = total * (target / 100)
      return { id, name: cat.name, icon: cat.icon, color: cat.color, value, share, target, targetValue, difference: value - targetValue }
    })
    const smallItems = rawData.filter((item) => item.share < SMALL_CATEGORY_SHARE)
    const regularItems = rawData.filter((item) => item.share >= SMALL_CATEGORY_SHARE)
    const grouped = smallItems.length ? [{ id: 'other-categories', name: 'Outras categorias', icon: '⋯', color: '#94a3b8', value: smallItems.reduce((sum, item) => sum + item.value, 0), share: smallItems.reduce((sum, item) => sum + item.share, 0), target: smallItems.reduce((sum, item) => sum + item.target, 0), targetValue: smallItems.reduce((sum, item) => sum + item.targetValue, 0), difference: smallItems.reduce((sum, item) => sum + item.difference, 0), items: smallItems }] : []
    const budgetRows = rawData.filter((item) => Number(budgets[item.id]) > 0)
    const budgetLimit = budgetRows.reduce((sum, item) => sum + Number(budgets[item.id]), 0)
    return { data: [...regularItems, ...grouped], budgetUsage: budgetLimit > 0 ? (budgetRows.reduce((sum, item) => sum + item.value, 0) / budgetLimit) * 100 : null }
  }, [byCategory, budgets, categories, total])
  const selectedItem = data.find((item) => item.id === selectedId)
  const hasTargets = data.some((item) => item.target > 0)
  if (!data.length) return <div className="card"><div className="card-head"><div><div className="card-title">Saídas por categoria</div><div className="card-sub">Distribuição dos gastos e reinvestimentos do mês</div></div></div><div className="empty"><div className="empty-icon"><PieChartIcon size={22} strokeWidth={1.6} /></div><div className="empty-title">Nenhuma saída neste mês</div><div className="text-sm">Adicione lançamentos para ver o gráfico.</div></div></div>
  const handleSelect = (id) => setSelectedId((current) => current === id ? null : id)
  return <div className="card category-card">
    <div className="card-head"><div><div className="card-title">Saídas por categoria</div><div className="card-sub">Distribuição dos gastos e reinvestimentos do mês</div></div></div>
    <div className="category-chart-layout">
      <div className="category-donut-wrap"><div className="category-donut-center" aria-label={`Total gasto: ${formatCurrency(total)}`}><strong>{formatCurrency(total)}</strong><span>Total gasto</span><small>{budgetUsage === null ? 'Sem meta mensal' : `${formatPercent(budgetUsage, 0)} da meta`}</small></div><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={78} outerRadius={128} paddingAngle={2} stroke="none" onClick={(item) => handleSelect(item.id)} onMouseEnter={(item) => setActiveId(item.id)} onMouseLeave={() => setActiveId(null)}>{data.map((entry) => <Cell key={entry.id} fill={entry.color} fillOpacity={activeId && activeId !== entry.id ? 0.3 : 1} stroke={activeId === entry.id ? 'var(--surface)' : 'none'} strokeWidth={activeId === entry.id ? 3 : 0} className="category-pie-cell" />)}</Pie><Tooltip content={<TooltipContent />} /></PieChart></ResponsiveContainer></div>
      <div className="category-list" aria-label="Categorias de saída">{data.map((item) => {
        const status = getStatus(item); const expanded = selectedId === item.id
        return <div key={item.id} className={`category-list-item${activeId === item.id ? ' is-active' : ''}${expanded ? ' is-expanded' : ''}`} onMouseEnter={() => setActiveId(item.id)} onMouseLeave={() => setActiveId(null)}><button type="button" className="category-row-button" onClick={() => handleSelect(item.id)} aria-expanded={expanded} aria-controls={`category-details-${item.id}`} aria-label={`${item.name}: ${formatCurrency(item.value)}, ${formatPercent(item.share, 1)} do total. ${status.label}. ${expanded ? 'Fechar' : 'Abrir'} detalhes.`}><span className="category-row-heading"><span className="category-icon"><AppIcon emoji={item.icon} /></span><span className="category-name">{item.name}</span><span className={`category-status status-${status.tone}`}><status.Icon size={14} aria-hidden="true" />{status.label}</span></span><span className="category-progress" aria-hidden="true"><span style={{ width: `${Math.min(item.share, 100)}%`, background: item.color }} /></span><span className="category-row-values"><strong>{formatCurrency(item.value)}</strong><span>{formatPercent(item.share, 1)} do total</span><ChevronDown className="category-chevron" size={17} aria-hidden="true" /></span></button>{expanded && <Details item={item} />}</div>
      })}</div>
    </div>
    {hasTargets && <div className="category-card-note">As metas percentuais comparam a participação prevista e a realizada de cada categoria.</div>}
  </div>
}
