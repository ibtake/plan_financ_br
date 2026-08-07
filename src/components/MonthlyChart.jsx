import { useMemo } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCompact, formatCurrency } from '../utils/format.js'

export default function MonthlyChart({ summary, occurrences, categories }) {
  const data = useMemo(() => {
    const incomeCategoryIds = new Set(categories.filter(c => c.type === 'income').map(c => c.id))
    const income = occurrences.filter(t => t.type === 'income').reduce((acc, t) => {
      const categoryId = incomeCategoryIds.has(t.categoryId) ? t.categoryId : '__uncategorized_income__'
      return { ...acc, [categoryId]: (acc[categoryId] || 0) + Number(t.amount || 0) }
    }, {})
    const expense = occurrences.filter(t => t.type === 'expense' || t.type === 'reinvested').reduce((acc, t) => ({ ...acc, [t.categoryId]: (acc[t.categoryId] || 0) + Number(t.amount || 0) }), {})
    const incomeTotal = Object.values(income).reduce((total, amount) => total + amount, 0)
    return [{ name: 'Receita', total: incomeTotal, ...Object.fromEntries(categories.map(c => [c.id, income[c.id] || 0])), __uncategorized_income__: income.__uncategorized_income__ || 0 }, { name: 'Despesas', total: (summary.expense || 0) + (summary.reinvested || 0), ...Object.fromEntries(categories.map(c => [c.id, expense[c.id] || 0])) }]
  }, [categories, occurrences, summary])
  const used = [...categories, { id: '__uncategorized_income__', color: '#94a3b8' }].filter(c => data.some(row => row[c.id] > 0))
  const MonthlyTooltip = ({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><div className="chart-tooltip-title">{label}</div><div className="chart-tooltip-row">{formatCurrency(Number(payload[0].payload.total) || 0)}</div></div> : null
  return <div className="card"><div className="card-head"><div><div className="card-title">Receita × Despesas</div><div className="card-sub">Distribuição do mês por categoria</div></div></div><div className="chart-wrap monthly-chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 5, left: -10, bottom: 0 }}><XAxis dataKey="name" tickLine={false} axisLine={false}/><YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false}/><Tooltip content={<MonthlyTooltip />} />{used.map((category, index) => <Bar key={category.id} dataKey={category.id} stackId="categories" fill={category.color} radius={index === used.length - 1 ? [5,5,0,0] : 0} />)}</BarChart></ResponsiveContainer></div></div>
}
