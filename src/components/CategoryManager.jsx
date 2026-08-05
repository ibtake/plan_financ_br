import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import { CHART_PALETTE, categoriesByType } from '../utils/categories.js'
import { formatCurrency } from '../utils/format.js'

const ICON_OPTIONS = [
  '🏠', '🍽️', '🛒', '🚗', '💊', '📚', '🎬', '📺', '🛍️', '🐾', '💳', '🧾',
  '📦', '💼', '💻', '📈', '🎁', '✈️', '⚽', '🎵', '👕', '🔧', '☕', '🍺',
]

function CategoryForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { name: '', type: 'expense', color: CHART_PALETTE[0], icon: '📦' },
  )
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const submit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave(form)
  }

  return (
    <form className="card" onSubmit={submit} style={{ background: 'var(--surface-2)' }}>
      <div className="form-grid">
        <div className="field">
          <label className="label">Nome *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Ex.: Viagens"
            autoFocus
          />
        </div>
        <div className="field">
          <label className="label">Tipo</label>
          <select
            className="select"
            value={form.type}
            onChange={(e) => set({ type: e.target.value })}
            disabled={Boolean(initial)}
          >
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
        </div>

        <div className="field span-2">
          <label className="label">Ícone</label>
          <div className="swatch-grid">
            {ICON_OPTIONS.map((ic) => (
              <button
                type="button"
                key={ic}
                className={`swatch${form.icon === ic ? ' selected' : ''}`}
                onClick={() => set({ icon: ic })}
                aria-label={`Ícone ${ic}`}
                aria-pressed={form.icon === ic}
              >
                <AppIcon emoji={ic} />
              </button>
            ))}
          </div>
        </div>

        <div className="field span-2">
          <label className="label">Cor</label>
          <div className="swatch-grid">
            {CHART_PALETTE.map((c) => (
              <button
                type="button"
                key={c}
                className={`color-dot${form.color === c ? ' selected' : ''}`}
                onClick={() => set({ color: c })}
                aria-label={`Cor ${c}`}
                aria-pressed={form.color === c}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary">
          Salvar categoria
        </button>
      </div>
    </form>
  )
}

function CategoryRow({ category, usage, onEdit, onDelete }) {
  return (
    <div className="tx" style={{ padding: '10px 4px' }}>
      <div
        className="tx-icon"
        style={{ background: `${category.color}22`, color: category.color }}
      >
        <AppIcon emoji={category.icon} />
      </div>
      <div className="tx-main">
        <div className="tx-desc">{category.name}</div>
        <div className="tx-meta">
          <span className={`chip ${category.type === 'income' ? 'income' : 'expense'}`}>
            {category.type === 'income' ? 'Receita' : 'Despesa'}
          </span>
          <span>
            {usage.count} {usage.count === 1 ? 'lançamento' : 'lançamentos'}
          </span>
          {usage.total > 0 && (
            <>
              <span>•</span>
              <span className="mono">{formatCurrency(usage.total)}</span>
            </>
          )}
        </div>
      </div>
      <div className="tx-actions">
        <button className="icon-btn" onClick={() => onEdit(category)} title="Editar">
          <Pencil size={15} strokeWidth={1.9} />
        </button>
        <button className="icon-btn danger" onClick={() => onDelete(category)} title="Excluir">
          <Trash2 size={15} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  )
}

export default function CategoryManager({
  categories,
  transactions,
  onAdd,
  onUpdate,
  onDelete,
}) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const usage = useMemo(() => {
    const map = {}
    for (const t of transactions) {
      const entry = map[t.categoryId] || { count: 0, total: 0 }
      entry.count += 1
      entry.total += Number(t.amount) || 0
      map[t.categoryId] = entry
    }
    return map
  }, [transactions])

  const expenses = categoriesByType(categories, 'expense')
  const incomes = categoriesByType(categories, 'income')

  const handleSave = (data) => {
    if (editing) onUpdate(editing.id, data)
    else onAdd(data)
    setShowForm(false)
    setEditing(null)
  }

  const handleDelete = (category) => {
    const used = usage[category.id]?.count || 0
    const message = used
      ? `A categoria "${category.name}" é usada em ${used} lançamento(s). Eles serão movidos para "Outros". Continuar?`
      : `Excluir a categoria "${category.name}"?`
    if (window.confirm(message)) onDelete(category.id)
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Categorias</div>
            <div className="card-sub">
              {expenses.length} de despesa • {incomes.length} de receita
            </div>
          </div>
          {!showForm && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditing(null)
                setShowForm(true)
              }}
            >
              <Plus size={15} strokeWidth={2.2} />
              Nova categoria
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <CategoryForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false)
            setEditing(null)
          }}
        />
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Despesas</div>
          </div>
          {expenses.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              usage={usage[c.id] || { count: 0, total: 0 }}
              onEdit={(cat) => {
                setEditing(cat)
                setShowForm(true)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              onDelete={handleDelete}
            />
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Receitas</div>
          </div>
          {incomes.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              usage={usage[c.id] || { count: 0, total: 0 }}
              onEdit={(cat) => {
                setEditing(cat)
                setShowForm(true)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
