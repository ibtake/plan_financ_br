import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCompact, formatCurrency, lastMonths, monthLabelShort } from '../utils/format.js'
import { expandMonth } from '../utils/recurrence.js'

const SEGMENT_GAP_COLOR = 'var(--surface)'

function useIsMobile() {
  const queryText = '(max-width: 768px)'
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(queryText).matches)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined

    const query = window.matchMedia(queryText)
    const update = () => setMobile(query.matches)
    update()

    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return mobile
}

function rankSegments(totals, colors) {
  return Object.entries(totals)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, amount, color: colors.get(id) || '#94a3b8' }))
    .sort((left, right) => right.amount - left.amount || left.id.localeCompare(right.id))
}

export default function MonthlyChart({ transactions, monthKey, categories }) {
  const isMobile = useIsMobile()
  const monthsToShow = isMobile ? 3 : 6
  const chart = useMemo(() => {
    const incomeCategoryIds = new Set(categories.filter((category) => category.type === 'income').map((category) => category.id))
    const expenseCategoryIds = new Set(categories.filter((category) => category.type === 'expense' || category.type === 'reinvested').map((category) => category.id))
    const colors = new Map(categories.map((category) => [category.id, category.color]))
    colors.set('__uncategorized_income__', '#94a3b8')
    colors.set('__uncategorized_expense__', '#94a3b8')

    const data = lastMonths(monthKey, monthsToShow).map((key) => {
      const income = {}
      const expense = {}
      for (const occurrence of expandMonth(transactions, key)) {
        const amount = Number(occurrence.amount) || 0
        if (occurrence.type === 'income') {
          const id = incomeCategoryIds.has(occurrence.categoryId) ? occurrence.categoryId : '__uncategorized_income__'
          income[id] = (income[id] || 0) + amount
        } else if (occurrence.type === 'expense' || occurrence.type === 'reinvested') {
          const id = expenseCategoryIds.has(occurrence.categoryId) ? occurrence.categoryId : '__uncategorized_expense__'
          expense[id] = (expense[id] || 0) + amount
        }
      }

      const incomeRanks = rankSegments(income, colors)
      const expenseRanks = rankSegments(expense, colors)
      const row = {
        name: monthLabelShort(key),
        incomeTotal: incomeRanks.reduce((total, item) => total + item.amount, 0),
        expenseTotal: expenseRanks.reduce((total, item) => total + item.amount, 0),
        incomeRanks,
        expenseRanks,
      }
      incomeRanks.forEach((item, index) => { row[`income:rank:${index}`] = item.amount })
      expenseRanks.forEach((item, index) => { row[`expense:rank:${index}`] = item.amount })
      return row
    })

    return {
      data,
      incomeRankCount: Math.max(0, ...data.map((row) => row.incomeRanks.length)),
      expenseRankCount: Math.max(0, ...data.map((row) => row.expenseRanks.length)),
    }
  }, [categories, monthKey, monthsToShow, transactions])

  const MonthlyTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const item = payload[0]
    const isIncome = String(item.dataKey).startsWith('income:')
    const total = isIncome ? item.payload.incomeTotal : item.payload.expenseTotal
    return <div className="chart-tooltip"><div className="chart-tooltip-title">{item.payload.name} · {isIncome ? 'Receita' : 'Despesas'}</div><div className="chart-tooltip-row">{formatCurrency(Number(total) || 0)}</div></div>
  }

  const roundedSegment = (kind, rank, row) => <Cell key={`${kind}-${rank}-${row.name}`} fill={row[`${kind}Ranks`][rank]?.color || 'transparent'} />
  return <div className="card"><div className="card-head"><div><div className="card-title">Receita × Despesas</div><div className="card-sub">{isMobile ? 'Últimos 3 meses' : 'Últimos 6 meses'} · distribuição por categoria</div></div></div><div className="chart-wrap monthly-chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart.data} margin={{ top: 8, right: isMobile ? 4 : 12, left: isMobile ? 2 : 8, bottom: 2 }} barGap={3}><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: isMobile ? 10 : 11 }} tickMargin={isMobile ? 6 : 8}/><YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: isMobile ? 9 : 10 }} width={isMobile ? 42 : 52}/><Tooltip shared={false} content={<MonthlyTooltip />} />{Array.from({ length: chart.incomeRankCount }, (_, rank) => <Bar key={`income-rank-${rank}`} dataKey={`income:rank:${rank}`} stackId="income" fill="transparent" stroke={SEGMENT_GAP_COLOR} strokeWidth={2} barSize={isMobile ? 18 : 24} radius={[5,5,5,5]}>{chart.data.map((row) => roundedSegment('income', rank, row))}</Bar>)}{Array.from({ length: chart.expenseRankCount }, (_, rank) => <Bar key={`expense-rank-${rank}`} dataKey={`expense:rank:${rank}`} stackId="expense" fill="transparent" stroke={SEGMENT_GAP_COLOR} strokeWidth={2} barSize={isMobile ? 18 : 24} radius={[5,5,5,5]}>{chart.data.map((row) => roundedSegment('expense', rank, row))}</Bar>)}</BarChart></ResponsiveContainer></div></div>
}
