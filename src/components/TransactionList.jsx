import { useMemo, useState } from 'react'
import {
  Check,
  Circle,
  Copy,
  Download,
  Pencil,
  Plus,
  Repeat,
  Search,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  Inbox,
} from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import { getCategory, getPaymentMethod } from '../utils/categories.js'
import { recurrenceLabel } from '../utils/recurrence.js'
import { formatCurrency, formatDate, monthLabel } from '../utils/format.js'

const SORTS = [
  { id: 'date-desc', label: 'Data (mais recente)' },
  { id: 'date-asc', label: 'Data (mais antiga)' },
  { id: 'amount-desc', label: 'Maior valor' },
  { id: 'amount-asc', label: 'Menor valor' },
  { id: 'desc-asc', label: 'Descrição (A–Z)' },
]

export function TransactionItem({ tx, categories, onEdit, onDelete, onDuplicate, onTogglePaid }) {
  const cat = getCategory(categories, tx.categoryId)
  const method = getPaymentMethod(tx.method)
  const repeat = recurrenceLabel(tx)
  const isIncome = tx.type === 'income'

  return (
    <div className={`tx${tx.paid ? '' : ' unpaid'}`}>
      <div
        className="tx-icon"
        style={{ background: `${cat.color}22`, color: cat.color }}
        title={cat.name}
      >
        <AppIcon emoji={cat.icon} />
      </div>

      <div className="tx-main">
        <div className="tx-desc">{tx.description}</div>
        <div className="tx-meta">
          <span>{formatDate(tx.date)}</span>
          <span aria-hidden="true">•</span>
          <span>{cat.name}</span>
          <span aria-hidden="true">•</span>
          <span title="Forma de pagamento">
            <AppIcon emoji={method.icon} size={13} /> {method.name}
          </span>
          {tx.installmentLabel && <span className="chip info">{tx.installmentLabel}</span>}
          {repeat && !tx.installmentLabel && (
            <span className="chip primary">
              <Repeat size={11} strokeWidth={2.2} />
              {repeat}
            </span>
          )}
          {!tx.paid && (
            <span className="chip warning">{isIncome ? 'A receber' : 'A pagar'}</span>
          )}
          {(tx.tags || []).map((tag) => (
            <span className="chip" key={tag}>
              #{tag}
            </span>
          ))}
        </div>
        {tx.note && (
          <div className="tx-note text-xs text-muted">
            <StickyNote size={12} strokeWidth={1.9} />
            <span>{tx.note}</span>
          </div>
        )}
      </div>

      <div className={`tx-amount ${isIncome ? 'income' : 'expense'} mono`}>
        {isIncome ? '+' : '−'} {formatCurrency(tx.amount)}
      </div>

      <div className="tx-actions">
        <button
          type="button"
          className={`icon-btn${tx.paid ? ' success' : ''}`}
          onClick={() => onTogglePaid(tx)}
          title={tx.paid ? 'Marcar como pendente' : 'Marcar como pago'}
          aria-label={tx.paid ? 'Marcar como pendente' : 'Marcar como pago'}
        >
          {tx.paid ? <Check size={16} strokeWidth={2.4} /> : <Circle size={16} strokeWidth={2} />}
        </button>
        <button type="button" className="icon-btn" onClick={() => onEdit(tx)} title="Editar" aria-label="Editar">
          <Pencil size={15} strokeWidth={1.9} />
        </button>
        <button type="button" className="icon-btn" onClick={() => onDuplicate(tx)} title="Duplicar" aria-label="Duplicar">
          <Copy size={15} strokeWidth={1.9} />
        </button>
        <button type="button" className="icon-btn danger" onClick={() => onDelete(tx)} title="Excluir" aria-label="Excluir">
          <Trash2 size={15} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  )
}

export default function TransactionList({
  occurrences,
  categories,
  monthKey,
  onEdit,
  onDelete,
  onDuplicate,
  onTogglePaid,
  onNew,
  onExportCSV,
  search: searchProp,
  onSearchChange,
}) {
  const [localSearch, setLocalSearch] = useState('')
  const [type, setType] = useState('all')
  const [categoryId, setCategoryId] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('date-desc')
  // No mobile os filtros comecam recolhidos para nao empurrar a lista
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Quando App controla a busca (barra do topo), ela vence; caso contrario o
  // componente segue funcionando sozinho com o estado local de antes.
  const controlled = typeof onSearchChange === 'function'
  const search = controlled ? (searchProp ?? '') : localSearch
  const setSearch = controlled ? onSearchChange : setLocalSearch

  const activeFilters =
    (type !== 'all' ? 1 : 0) +
    (categoryId !== 'all' ? 1 : 0) +
    (status !== 'all' ? 1 : 0) +
    (sort !== 'date-desc' ? 1 : 0)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = occurrences.filter((t) => {
      if (type !== 'all' && t.type !== type) return false
      if (categoryId !== 'all' && t.categoryId !== categoryId) return false
      if (status === 'paid' && !t.paid) return false
      if (status === 'pending' && t.paid) return false
      if (q) {
        const cat = getCategory(categories, t.categoryId)
        const haystack = `${t.description} ${cat.name} ${(t.tags || []).join(' ')} ${t.note || ''}`
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'date-asc':
          return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
        case 'amount-desc':
          return b.amount - a.amount
        case 'amount-asc':
          return a.amount - b.amount
        case 'desc-asc':
          return a.description.localeCompare(b.description, 'pt-BR')
        default:
          return a.date > b.date ? -1 : a.date < b.date ? 1 : 0
      }
    })

    return list
  }, [occurrences, search, type, categoryId, status, sort, categories])

  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    for (const t of filtered) {
      if (t.type === 'income') income += t.amount
      else expense += t.amount
    }
    return { income, expense, count: filtered.length }
  }, [filtered])

  const usedCategories = useMemo(() => {
    const ids = new Set(occurrences.map((t) => t.categoryId))
    return categories.filter((c) => ids.has(c.id))
  }, [occurrences, categories])

  return (
    <div className="card">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="card-title">Lançamentos de {monthLabel(monthKey)}</div>
          <div className="card-sub">
            {totals.count} {totals.count === 1 ? 'registro' : 'registros'} • entradas{' '}
            <span className="text-income fw-600">{formatCurrency(totals.income)}</span> • saídas{' '}
            <span className="text-expense fw-600">{formatCurrency(totals.expense)}</span>
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => onExportCSV(filtered)} title="Exportar CSV">
            <Download size={15} strokeWidth={1.9} />
            CSV
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNew}>
            <Plus size={15} strokeWidth={2.2} />
            Novo
          </button>
        </div>
      </div>

      {/* Botao que expande os filtros — visivel apenas no mobile */}
      <button
        type="button"
        className="filters-toggle"
        onClick={() => setFiltersOpen((open) => !open)}
        aria-expanded={filtersOpen}
      >
        <SlidersHorizontal size={15} strokeWidth={1.9} />
        <span>Filtros e ordenação</span>
        {activeFilters > 0 && <span className="chip primary">{activeFilters}</span>}
      </button>

      <div className={`filters collapsible${filtersOpen ? ' open' : ''}`}>
        <div className="search-box">
          <Search size={15} strokeWidth={2} aria-hidden="true" />
          <input
            className="input"
            placeholder="Buscar por descrição, categoria, tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar lançamentos"
          />
        </div>

        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="all">Todos os tipos</option>
          <option value="income">Somente receitas</option>
          <option value="expense">Somente despesas</option>
        </select>

        <select
          className="select"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="Categoria"
        >
          <option value="all">Todas as categorias</option>
          {usedCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Situação"
        >
          <option value="all">Pagos e pendentes</option>
          <option value="paid">Somente pagos</option>
          <option value="pending">Somente pendentes</option>
        </select>

        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenação">
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="divider" />

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Inbox size={22} strokeWidth={1.6} />
          </div>
          <div className="empty-title">
            {occurrences.length === 0
              ? 'Nenhum lançamento neste mês'
              : 'Nenhum resultado para os filtros'}
          </div>
          <div className="text-sm">
            {occurrences.length === 0
              ? 'Clique em "Novo" para registrar sua primeira movimentação.'
              : 'Tente ajustar a busca ou limpar os filtros.'}
          </div>
        </div>
      ) : (
        <div className="tx-list">
          {filtered.map((tx) => (
            <TransactionItem
              key={tx.id}
              tx={tx}
              categories={categories}
              onEdit={onEdit}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onTogglePaid={onTogglePaid}
            />
          ))}
        </div>
      )}
    </div>
  )
}
