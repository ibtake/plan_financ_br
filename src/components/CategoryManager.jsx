import { useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash2, Upload } from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import { useIcons, STORAGE_FULL_MESSAGE } from '../contexts/IconContext.jsx'
import { CHART_PALETTE, TYPE_META, categoriesByType } from '../utils/categories.js'
import { ICON_CATALOG, ICON_GROUPS } from '../utils/iconRegistry.js'
import { readIconFile } from '../utils/iconUpload.js'
import { formatCurrency } from '../utils/format.js'

/** Tipos que aceitam meta percentual (REQ 6): receita fica de fora */
const TARGET_TYPES = ['expense', 'reinvested']

/**
 * REQ 5: seletor de ícone com todo o catálogo, agrupado, mais o envio de um
 * PNG personalizado.
 *
 * O PNG enviado vira um override do emoji selecionado (mesmo mecanismo da aba
 * Ícones), então ele passa a valer em qualquer tela que use <AppIcon>, e a
 * categoria continua guardando apenas o caractere do emoji no banco.
 */
function IconPicker({ value, onChange }) {
  const { setOverride, hasOverride } = useIcons()
  const inputRef = useRef(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase()
    const buckets = new Map()
    for (const item of ICON_CATALOG) {
      if (term && !item.label.toLowerCase().includes(term) && item.emoji !== term) continue
      if (!buckets.has(item.group)) buckets.set(item.group, [])
      buckets.get(item.group).push(item)
    }
    return buckets
  }, [search])

  const handleUpload = async (file) => {
    setBusy(true)
    setError('')
    try {
      const dataUrl = await readIconFile(file)
      if (!setOverride(value, dataUrl)) setError(STORAGE_FULL_MESSAGE)
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="icon-picker">
      <div className="icon-picker-head">
        <div className="icon-picker-current">
          <AppIcon emoji={value} size={26} />
          <span className="text-xs text-muted">
            {hasOverride(value) ? 'PNG personalizado aplicado' : 'Ícone selecionado'}
          </span>
        </div>
        <input
          name="icon-search"
          className="input icon-picker-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar ícone..."
          aria-label="Buscar ícone"
        />
      </div>

      <div className="icon-picker-body">
        {ICON_GROUPS.filter((group) => grouped.has(group.id)).map((group) => (
          <div className="icon-picker-group" key={group.id}>
            <div className="icon-picker-group-title">{group.name}</div>
            <div className="swatch-grid">
              {grouped.get(group.id).map((item) => (
                <button
                  type="button"
                  key={item.emoji}
                  className={`swatch${value === item.emoji ? ' selected' : ''}`}
                  onClick={() => onChange(item.emoji)}
                  title={item.label}
                  aria-label={`Ícone ${item.label}`}
                  aria-pressed={value === item.emoji}
                >
                  <AppIcon emoji={item.emoji} />
                </button>
              ))}
            </div>
          </div>
        ))}
        {grouped.size === 0 && (
          <div className="text-xs text-muted">Nenhum ícone corresponde à busca.</div>
        )}
      </div>

      <div className="icon-picker-upload">
        <input
          name="icon-upload"
          ref={inputRef}
          type="file"
          accept="image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleUpload(file)
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={14} strokeWidth={2} />
          {hasOverride(value) ? 'Trocar PNG do ícone' : 'Enviar PNG personalizado'}
        </button>
        <span className="hint">
          O PNG substitui o ícone selecionado em todas as telas. Quadrado, até 1 MB.
        </span>
      </div>

      {error && <div className="notice danger" role="alert">{error}</div>}
    </div>
  )
}

function CategoryForm({ initial, onSave, onCancel, otherTargetTotal }) {
  const [form, setForm] = useState(
    initial || {
      name: '',
      type: 'expense',
      color: CHART_PALETTE[0],
      icon: '📦',
      targetPercentage: 0,
    },
  )
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const showTarget = TARGET_TYPES.includes(form.type)
  const target = Math.max(0, Math.min(100, Number(form.targetPercentage) || 0))
  // REQ 6: a soma das metas de despesa + reinvestimento não pode passar de 100%
  const totalTarget = otherTargetTotal + (showTarget ? target : 0)
  const overLimit = totalTarget > 100

  const submit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    if (overLimit) return
    onSave({ ...form, targetPercentage: showTarget ? target : 0 })
  }

  return (
    <form className="card" onSubmit={submit} style={{ background: 'var(--surface-2)' }}>
      <div className="form-grid">
        <div className="field">
          <label className="label">Nome *</label>
          <input
            name="category-name"
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
            name="category-type"
            className="select"
            value={form.type}
            onChange={(e) => set({ type: e.target.value })}
            disabled={Boolean(initial)}
          >
            <option value="expense">Despesa</option>
            <option value="reinvested">Despesa Reinvestida</option>
            <option value="income">Receita</option>
          </select>
          {form.type === 'reinvested' && (
            <span className="hint">Sai da liquidez, mas acumula patrimônio.</span>
          )}
        </div>

        {showTarget && (
          <div className="field span-2">
            <label className="label" htmlFor="cat-target">
              % esperada do total (meta)
            </label>
            <input
              id="cat-target"
              name="category-target-percentage"
              type="number"
              min="0"
              max="100"
              step="0.5"
              className={`input mono${overLimit ? ' input-invalid' : ''}`}
              value={form.targetPercentage ?? 0}
              onChange={(e) => set({ targetPercentage: e.target.value })}
            />
            {overLimit ? (
              <span className="field-error">
                A soma das metas chegaria a {totalTarget.toFixed(1)}%. Reduza para no máximo{' '}
                {(100 - otherTargetTotal).toFixed(1)}% nesta categoria.
              </span>
            ) : (
              <span className="hint">
                Já distribuídos: {totalTarget.toFixed(1)}% de 100% — restam{' '}
                {(100 - totalTarget).toFixed(1)}%.
              </span>
            )}
          </div>
        )}

        <div className="field span-2">
          <label className="label">Ícone</label>
          <IconPicker value={form.icon} onChange={(icon) => set({ icon })} />
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
        <button type="submit" className="btn btn-primary" disabled={overLimit}>
          Salvar categoria
        </button>
      </div>
    </form>
  )
}

function CategoryRow({ category, usage, onEdit, onDelete }) {
  const meta = TYPE_META[category.type] || TYPE_META.expense
  const target = Number(category.targetPercentage) || 0
  // Toda categoria e excluivel, as 22 padrao inclusive: a policy `own categories
  // delete` (schema.sql:650-654) so checa o dono, nao ha trigger de delete e
  // `custom` (schema.sql:611) e informativo. deleteCategory realoca os lancamentos
  // antes de excluir (useSupabaseFinance.js:398-413), e handleDelete (:352) pede
  // confirmacao dizendo quantos serao movidos - nao ha nada a bloquear aqui.

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
          <span className={`chip ${meta.chip}`}>{meta.label}</span>
          {target > 0 && <span className="chip">meta {target.toFixed(1)}%</span>}
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
        <button
          className="icon-btn danger"
          onClick={() => onDelete(category)}
          title="Excluir"
        >
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
  const reinvested = categoriesByType(categories, 'reinvested')
  const incomes = categoriesByType(categories, 'income')

  // REQ 6: soma das metas já cadastradas, ignorando a categoria em edição —
  // é o teto que o formulário usa para validar o valor digitado.
  const otherTargetTotal = useMemo(
    () =>
      categories
        .filter((c) => TARGET_TYPES.includes(c.type) && c.id !== editing?.id)
        .reduce((sum, c) => sum + (Number(c.targetPercentage) || 0), 0),
    [categories, editing],
  )

  // Sem guarda local de duplo-clique, de proposito. `setShowForm(false)` roda dentro
  // do evento de clique (lane sincrona): o formulario desmonta antes de o navegador
  // despachar o clique seguinte, e `addCategory` ainda segura
  // `categoryInsertInFlight` durante a escrita inteira
  // (useSupabaseFinance.js:316-330). A janela so abre se o CategoryForm ganhar
  // animacao de saida como o TransactionForm - la o botao segue clicavel por ~240ms
  // e o guard local e obrigatorio (TransactionForm.jsx:93-97). Nesse caso volte um
  // guard aqui, resetado DEPOIS da escrita; resetar no mesmo tick foi o defeito do
  // trecho removido em 21/08/2026, que nunca bloqueou nada.
  const handleSave = (data) => {
    if (editing) onUpdate(editing.id, data)
    else onAdd(data)
    setShowForm(false)
    setEditing(null)
  }

  const handleDelete = (category) => {
    if (!category) return
    const used = usage[category.id]?.count || 0
    const message = used
      ? `A categoria "${category.name}" é usada em ${used} lançamento(s). Eles serão movidos para outra categoria do mesmo tipo. Continuar?`
      : `Excluir a categoria "${category.name}"?`
    if (window.confirm(message)) onDelete(category.id)
  }

  const startEdit = (cat) => {
    setEditing(cat)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const sections = [
    { key: 'expense', title: 'Despesas', items: expenses },
    { key: 'reinvested', title: 'Despesas reinvestidas', items: reinvested },
    { key: 'income', title: 'Receitas', items: incomes },
  ]

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Categorias</div>
            <div className="card-sub">
              {expenses.length} de despesa • {reinvested.length} reinvestida
              {reinvested.length === 1 ? '' : 's'} • {incomes.length} de receita
              {otherTargetTotal > 0 && ` • metas somam ${otherTargetTotal.toFixed(1)}%`}
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
          otherTargetTotal={otherTargetTotal}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false)
            setEditing(null)
          }}
        />
      )}

      <div className="grid-2">
        {sections.map((section) => (
          <div className="card" key={section.key}>
            <div className="card-head">
              <div className="card-title">{section.title}</div>
            </div>
            {section.items.length === 0 ? (
              <div className="text-sm text-muted">Nenhuma categoria neste grupo ainda.</div>
            ) : (
              section.items.map((c) => (
                <CategoryRow
                  key={c.id}
                  category={c}
                  usage={usage[c.id] || { count: 0, total: 0 }}
                  onEdit={startEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
