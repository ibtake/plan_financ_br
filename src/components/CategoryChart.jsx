import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, MinusCircle, PieChart as PieChartIcon } from 'lucide-react'
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
  return <div className="chart-tooltip"><div className="chart-tooltip-title"><AppIcon emoji={item.icon} /> {item.name}</div><div className="chart-tooltip-row"><span className="chart-dot" style={{ background: item.color }} /><strong>{formatCurrency(item.value)}</strong><span>({formatPercent(item.share, 1)} do total)</span></div><div className="chart-tooltip-row text-muted">Meta {formatPercent(item.target, 1)} · {status.label}</div></div>
}

function ShowAllButton({ expanded, onClick }) {
  return <button type="button" className="category-show-all" onClick={onClick}>{expanded ? 'Ver menos categorias' : 'Ver todas as categorias'}<ChevronRight size={16} aria-hidden="true" /></button>
}

/** Dois cards de apresentação que preservam os mesmos cálculos e dados do gráfico anterior. */
export default function CategoryChart({ byCategory, categories, total, incomeTotal = 0 }) {
  const [activeId, setActiveId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const data = useMemo(() => {
    const rawData = Object.entries(byCategory).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([id, value]) => {
      const cat = getCategory(categories, id)
      const target = Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0))
      const share = total > 0 ? (value / total) * 100 : 0
      const targetValue = total * (target / 100)
      return { id, name: cat.name, icon: cat.icon, color: cat.color, value, share, target, targetValue, difference: value - targetValue }
    })
    const small = rawData.filter((item) => item.share < SMALL_CATEGORY_SHARE)
    const regular = rawData.filter((item) => item.share >= SMALL_CATEGORY_SHARE)
    const grouped = small.length ? [{ id: 'other-categories', name: 'Outras categorias', icon: '⋯', color: '#94a3b8', value: small.reduce((sum, item) => sum + item.value, 0), share: small.reduce((sum, item) => sum + item.share, 0), target: small.reduce((sum, item) => sum + item.target, 0), targetValue: small.reduce((sum, item) => sum + item.targetValue, 0), difference: small.reduce((sum, item) => sum + item.difference, 0), items: small }] : []
    return [...regular, ...grouped]
  }, [byCategory, categories, total])

  if (!data.length) return <div className="card"><div className="card-head"><div><div className="card-title">Distribuição das despesas</div><div className="card-sub">Total gasto no mês</div></div></div><div className="empty"><div className="empty-icon"><PieChartIcon size={22} strokeWidth={1.6} /></div><div className="empty-title">Nenhuma saída neste mês</div><div className="text-sm">Adicione lançamentos para ver a distribuição.</div></div></div>

  const displayedLegend = showAll ? data : data.slice(0, 7)
  const displayedRows = showAll ? data : data.slice(0, 7)
  const toggleAll = () => setShowAll((value) => !value)
  const expenseOfIncome = incomeTotal > 0 ? (total / incomeTotal) * 100 : null

  return <div className="expense-cards-layout">
    <section className="card expense-distribution-card">
      <div className="card-head"><div><div className="card-title">Distribuição das despesas</div><div className="card-sub">Total gasto no mês</div></div></div>
      <div className="expense-donut-wrap">
        <div className="expense-donut-center" aria-label={`Total gasto: ${formatCurrency(total)}`}><strong>{formatCurrency(total)}</strong><span>Total gasto</span><small>{expenseOfIncome === null ? 'Sem receita no mês' : `Já gastou ${formatPercent(expenseOfIncome, 0)}`}</small></div>
        <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={82} outerRadius={132} paddingAngle={2} stroke="none" onMouseEnter={(item) => setActiveId(item.id)} onMouseLeave={() => setActiveId(null)} onClick={(item) => setActiveId(item.id)}>{data.map((item) => <Cell key={item.id} fill={item.color} fillOpacity={activeId && activeId !== item.id ? 0.3 : 1} stroke={activeId === item.id ? 'var(--surface)' : 'none'} strokeWidth={activeId === item.id ? 3 : 0} />)}</Pie><Tooltip content={<TooltipContent />} /></PieChart></ResponsiveContainer>
      </div>
      <div className="expense-donut-legend">{displayedLegend.map((item) => <button type="button" key={item.id} className={`expense-legend-row${activeId === item.id ? ' is-active' : ''}`} onMouseEnter={() => setActiveId(item.id)} onMouseLeave={() => setActiveId(null)} onClick={() => setActiveId(item.id)} aria-label={`${item.name}: ${formatCurrency(item.value)}, ${formatPercent(item.share, 1)} do total`}><span className="chart-dot" style={{ background: item.color }} /><span className="expense-legend-name"><AppIcon emoji={item.icon} /> {item.name}</span><strong>{formatCurrency(item.value)}</strong><span>{formatPercent(item.share, 1)}</span></button>)}</div>
      {data.length > 7 && <ShowAllButton expanded={showAll} onClick={toggleAll} />}
    </section>

    <section className="card expense-analysis-card">
      <div className="card-head"><div><div className="card-title">Por categoria</div><div className="card-sub">Análise detalhada dos gastos</div></div></div>
      <div className="expense-analysis-head" aria-hidden="true"><span>Categoria</span><span>Meta<br />(%)</span><span>Real<br />(%)</span><span>Diferença<br />(R$)</span><span>Diferença<br />(p.p.)</span><span>Status</span></div>
      <div className="expense-analysis-list">{displayedRows.map((item) => {
        const status = getStatus(item); const prefix = item.difference >= 0 ? '+' : '−'; const percentageDifference = item.target > 0 ? item.share - item.target : 0; const expanded = expandedId === item.id
        const toggleExpanded = () => { setActiveId(item.id); setExpandedId((current) => current === item.id ? null : item.id) }
        return <button type="button" key={item.id} className={`expense-analysis-row${activeId === item.id ? ' is-active' : ''}${expanded ? ' is-expanded' : ''}`} onMouseEnter={() => setActiveId(item.id)} onMouseLeave={() => setActiveId(null)} onClick={toggleExpanded} aria-expanded={expanded} aria-controls={`mobile-category-details-${item.id}`} aria-label={`${item.name}: ${formatCurrency(item.value)}, ${formatPercent(item.share, 1)} do total. ${status.label}. ${expanded ? 'Fechar' : 'Abrir'} detalhes.`}><span className="expense-category-cell"><span className="expense-category-icon"><AppIcon emoji={item.icon} /></span><span className="expense-category-copy"><strong>{item.name}</strong><span className="expense-share-bar"><span style={{ width: `${Math.min(item.share, 100)}%`, background: item.color }} /></span><small>{formatCurrency(item.value)}</small></span></span><span data-label="Meta">{formatPercent(item.target, 0)}</span><span data-label="Real">{formatPercent(item.share, 0)}</span><span data-label="Diferença R$" className={item.difference > 0 ? 'difference-danger' : 'difference-success'}>{prefix}{formatCurrency(Math.abs(item.difference))}</span><span data-label="Diferença p.p." className={percentageDifference > 0 ? 'difference-danger' : 'difference-success'}>{prefix}{formatPercent(Math.abs(percentageDifference), 0)} p.p.</span><span className={`expense-status status-${status.tone}`}><status.Icon size={14} aria-hidden="true" />{status.label}</span><span className="mobile-category-summary"><span className="mobile-category-top"><span className="expense-category-icon"><AppIcon emoji={item.icon} /></span><strong>{item.name}</strong><span className={`mobile-category-status status-${status.tone}`}><status.Icon size={15} aria-hidden="true" />{status.label}</span><ChevronDown className="mobile-category-chevron" size={17} aria-hidden="true" /></span><span className="expense-share-bar"><span style={{ width: `${Math.min(item.share, 100)}%`, background: item.color }} /></span><span className="mobile-category-footer"><strong>{formatCurrency(item.value)}</strong><span>{formatPercent(item.share, 0)} do total</span></span></span><span className="mobile-category-details" id={`mobile-category-details-${item.id}`}><span><small>Meta</small><strong>{formatPercent(item.target, 0)}</strong></span><span><small>Real</small><strong>{formatPercent(item.share, 0)}</strong></span><span className={item.difference > 0 ? 'difference-danger' : 'difference-success'}><small>Diferença</small><strong>{prefix}{formatCurrency(Math.abs(item.difference))}</strong></span><span className={percentageDifference > 0 ? 'difference-danger' : 'difference-success'}><small>Diferença p.p.</small><strong>{prefix}{formatPercent(Math.abs(percentageDifference), 0)} p.p.</strong></span><span className={`mobile-detail-status status-${status.tone}`}><small>Status</small><strong><status.Icon size={14} aria-hidden="true" />{status.label}</strong></span></span></button>
      })}</div>
      {data.length > 7 && <ShowAllButton expanded={showAll} onClick={toggleAll} />}
    </section>
  </div>
}
