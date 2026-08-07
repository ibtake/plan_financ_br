import { useMemo } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCompact, formatCurrency } from '../utils/format.js'

export default function MonthlyChart({ summary, occurrences, categories }) {
  const data = useMemo(() => {
    const income = categories.filter(c => c.type === 'income').reduce((acc, c) => ({ ...acc, [c.id]: (summary.income || 0) * ((Number(c.targetPercentage) || 0) / 100) }), {})
    const expense = occurrences.filter(t => t.type === 'expense' || t.type === 'reinvested').reduce((acc, t) => ({ ...acc, [t.categoryId]: (acc[t.categoryId] || 0) + Number(t.amount || 0) }), {})
    return [{ name: 'Receita', total: summary.income || 0, ...Object.fromEntries(categories.map(c => [c.id, income[c.id] || 0])) }, { name: 'Despesas', total: (summary.expense || 0) + (summary.reinvested || 0), ...Object.fromEntries(categories.map(c => [c.id, expense[c.id] || 0])) }]
  }, [categories, occurrences, summary])
  const used = categories.filter(c => data.some(row => row[c.id] > 0))
  return <div className="card"><div className="card-head"><div><div className="card-title">Receita × Despesas</div><div className="card-sub">Distribuição do mês por categoria</div></div></div><div className="chart-wrap monthly-chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 5, left: -10, bottom: 0 }}><XAxis dataKey="name" tickLine={false} axisLine={false}/><YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false}/><Tooltip formatter={(value, _name, item) => item.payload.total === value ? formatCurrency(value) : null} labelFormatter={label => label} /><Bar dataKey="total" fill="transparent" stackId="categories" isAnimationActive={false} legendType="none" />{used.map((category, index) => <Bar key={category.id} dataKey={category.id} stackId="categories" fill={category.color} radius={index === used.length - 1 ? [5,5,0,0] : 0} />)}</BarChart></ResponsiveContainer></div></div>
}
