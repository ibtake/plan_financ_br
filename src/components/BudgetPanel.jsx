import { useMemo, useState } from 'react'
import AppIcon from './AppIcon.jsx'
import { categoriesByType, getCategory } from '../utils/categories.js'
import { formatCurrency, formatPercent, monthLabel, parseAmount } from '../utils/format.js'

function barClass(percent) {
  if (percent >= 100) return 'over'
  if (percent >= 80) return 'warn'
  return 'ok'
}

function BudgetRow({ category, spent, limit, onChange, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(limit))
  const percent = limit > 0 ? (spent / limit) * 100 : 0
  const remaining = limit - spent

  const save = () => {
    onChange(category.id, parseAmount(draft))
    setEditing(false)
  }

  return (
    <div className="budget-item">
      <div className="row-between" style={{ marginBottom: 9 }}>
        <div className="row">
          <span
            className="tx-icon"
            style={{
              background: `${category.color}22`,
              color: category.color,
              width: 32,
              height: 32,
              fontSize: 15,
              borderRadius: 9,
            }}
          >
            <AppIcon emoji={category.icon} />
          </span>
          <div>
            <div className="fw-600">{category.name}</div>
            <div className="text-xs text-muted">
              {formatCurrency(spent)} de {formatCurrency(limit)}
            </div>
          </div>
        </div>

        <div className="row">
          {editing ? (
            <>
              <input
                className="input mono"
                style={{ width: 120 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save()
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
                inputMode="decimal"
              />
              <button className="btn btn-sm btn-primary" onClick={save}>
                OK
              </button>
            </>
          ) : (
            <>
              <span
                className={`chip ${percent >= 100 ? 'expense' : percent >= 80 ? 'warning' : 'income'}`}
              >
                {formatPercent(percent)}
              </span>
              <button
                className="icon-btn"
                onClick={() => {
                  setDraft(String(limit))
                  setEditing(true)
                }}
                title="Editar limite"
              >
                ✏️
              </button>
              <button
                className="icon-btn danger"
                onClick={() => onRemove(category.id)}
                title="Remover orçamento"
              >
                🗑️
              </button>
            </>
          )}
        </div>
      </div>

      <div className="progress">
        <div
          className={`progress-bar ${barClass(percent)}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      <div className="text-xs" style={{ marginTop: 6 }}>
        {remaining >= 0 ? (
          <span className="text-muted">
            Ainda disponível: <span className="text-income fw-600">{formatCurrency(remaining)}</span>
          </span>
        ) : (
          <span className="text-expense fw-600">
            ⚠️ Estourou em {formatCurrency(Math.abs(remaining))}
          </span>
        )}
      </div>
    </div>
  )
}

export default function BudgetPanel({ budgets, byCategory, categories, monthKey, onSetBudget }) {
  const [newCategory, setNewCategory] = useState('')
  const [newLimit, setNewLimit] = useState('')

  const expenseCategories = useMemo(() => categoriesByType(categories, 'expense'), [categories])

  const rows = useMemo(
    () =>
      Object.entries(budgets)
        .map(([id, limit]) => ({
          category: getCategory(categories, id),
          limit: Number(limit) || 0,
          spent: byCategory[id] || 0,
        }))
        .sort((a, b) => b.spent / (b.limit || 1) - a.spent / (a.limit || 1)),
    [budgets, byCategory, categories],
  )

  const available = expenseCategories.filter((c) => budgets[c.id] === undefined)

  const totals = useMemo(() => {
    const limit = rows.reduce((s, r) => s + r.limit, 0)
    const spent = rows.reduce((s, r) => s + r.spent, 0)
    const untracked = Object.entries(byCategory)
      .filter(([id]) => budgets[id] === undefined)
      .reduce((s, [, v]) => s + v, 0)
    return { limit, spent, untracked, percent: limit > 0 ? (spent / limit) * 100 : 0 }
  }, [rows, byCategory, budgets])

  const handleAdd = (e) => {
    e.preventDefault()
    const value = parseAmount(newLimit)
    if (!newCategory || value <= 0) return
    onSetBudget(newCategory, value)
    setNewCategory('')
    setNewLimit('')
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Orçamento de {monthLabel(monthKey)}</div>
            <div className="card-sub">Defina um limite de gasto para cada categoria</div>
          </div>
        </div>

        {rows.length > 0 && (
          <>
            <div className="row-between" style={{ marginBottom: 9 }}>
              <span className="fw-600">Total orçado</span>
              <span className="mono fw-700">
                {formatCurrency(totals.spent)}{' '}
                <span className="text-muted fw-600">/ {formatCurrency(totals.limit)}</span>
              </span>
            </div>
            <div className="progress" style={{ height: 12 }}>
              <div
                className={`progress-bar ${barClass(totals.percent)}`}
                style={{ width: `${Math.min(100, totals.percent)}%` }}
              />
            </div>
            <div className="row-between text-xs text-muted" style={{ marginTop: 7 }}>
              <span>{formatPercent(totals.percent)} do orçamento usado</span>
              {totals.untracked > 0 && (
                <span>+ {formatCurrency(totals.untracked)} em categorias sem orçamento</span>
              )}
            </div>
            <div className="divider" />
          </>
        )}

        <form className="filters" onSubmit={handleAdd}>
          <select
            className="select grow"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          >
            <option value="">Escolha uma categoria...</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <input
            className="input mono"
            style={{ width: 150 }}
            placeholder="Limite R$"
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            inputMode="decimal"
          />
          <button className="btn btn-primary" type="submit" disabled={!newCategory}>
            ➕ Definir
          </button>
        </form>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🎯</div>
            <div className="empty-title">Nenhum orçamento definido</div>
            <div className="text-sm">
              Escolha uma categoria acima e defina quanto pretende gastar por mês.
            </div>
          </div>
        ) : (
          rows.map((row) => (
            <BudgetRow
              key={row.category.id}
              category={row.category}
              spent={row.spent}
              limit={row.limit}
              onChange={onSetBudget}
              onRemove={(id) => onSetBudget(id, 0)}
            />
          ))
        )}
      </div>
    </div>
  )
}
