import { useState } from 'react'
import { CalendarClock, Lightbulb, PartyPopper, Pencil, Plus, Trash2, Trophy } from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import { formatCurrency, formatDate, formatPercent, parseAmount } from '../utils/format.js'

// Ícones e cores gravados junto da meta no banco — continuam sendo dados,
// não decoração de interface.
const ICONS = ['🎯', '🛟', '✈️', '🏠', '🚗', '💻', '🎓', '💍', '🏖️', '📱', '🐣', '🎁']
const COLORS = ['#6366f1', '#22c55e', '#0ea5e9', '#f97316', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b']

/** Meses restantes até o prazo */
function monthsLeft(deadline) {
  if (!deadline) return null
  const target = new Date(`${String(deadline).slice(0, 10)}T00:00:00`)
  const now = new Date()
  const diff =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
  return diff
}

function GoalForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { name: '', target: '', current: '', deadline: '', icon: '🎯', color: '#6366f1' },
  )
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const submit = (e) => {
    e.preventDefault()
    if (!form.name.trim() || parseAmount(form.target) <= 0) return
    onSave({
      ...form,
      target: parseAmount(form.target),
      current: parseAmount(form.current),
    })
  }

  return (
    <form className="card" onSubmit={submit} style={{ background: 'var(--surface-2)' }}>
      <div className="form-grid">
        <div className="field span-2">
          <label className="label">Nome da meta *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Ex.: Reserva de emergência"
            autoFocus
          />
        </div>
        <div className="field">
          <label className="label">Valor alvo (R$) *</label>
          <input
            className="input mono"
            value={form.target}
            onChange={(e) => set({ target: e.target.value })}
            placeholder="0,00"
            inputMode="decimal"
          />
        </div>
        <div className="field">
          <label className="label">Já guardado (R$)</label>
          <input
            className="input mono"
            value={form.current}
            onChange={(e) => set({ current: e.target.value })}
            placeholder="0,00"
            inputMode="decimal"
          />
        </div>
        <div className="field">
          <label className="label">Prazo</label>
          <input
            type="date"
            className="input"
            value={form.deadline ? String(form.deadline).slice(0, 10) : ''}
            onChange={(e) => set({ deadline: e.target.value })}
          />
        </div>
        <div className="field span-2">
          <label className="label">Ícone e cor</label>
          <div className="swatch-grid">
            {ICONS.map((ic) => (
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
          <div className="swatch-grid" style={{ marginTop: 8 }}>
            {COLORS.map((c) => (
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

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary">
          Salvar meta
        </button>
      </div>
    </form>
  )
}

function GoalCard({ goal, onUpdate, onDelete, onEdit }) {
  const [contribution, setContribution] = useState('')
  const percent = goal.target > 0 ? (goal.current / goal.target) * 100 : 0
  const remaining = Math.max(0, goal.target - goal.current)
  const left = monthsLeft(goal.deadline)
  const perMonth = left && left > 0 ? remaining / left : remaining
  const done = percent >= 100

  const contribute = (e) => {
    e.preventDefault()
    const value = parseAmount(contribution)
    if (value === 0) return
    onUpdate(goal.id, { current: Math.max(0, goal.current + value) })
    setContribution('')
  }

  return (
    <div className="goal-card">
      <div className="row-between" style={{ gap: 10 }}>
        <div className="row" style={{ minWidth: 0 }}>
          <div className="goal-icon" style={{ background: `${goal.color}22`, color: goal.color }}>
            <AppIcon emoji={goal.icon} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="fw-600 truncate">{goal.name}</div>
            <div className="text-xs text-muted">
              {goal.deadline ? `Prazo: ${formatDate(goal.deadline)}` : 'Sem prazo definido'}
            </div>
          </div>
        </div>
        <div className="row" style={{ flex: 'none' }}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onEdit(goal)}
            title="Editar"
            aria-label={`Editar meta ${goal.name}`}
          >
            <Pencil size={15} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="icon-btn danger"
            onClick={() => onDelete(goal.id)}
            title="Excluir"
            aria-label={`Excluir meta ${goal.name}`}
          >
            <Trash2 size={15} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div>
        <div className="row-between text-sm" style={{ marginBottom: 7, gap: 8 }}>
          <span className="mono fw-700" style={{ color: goal.color }}>
            {formatCurrency(goal.current)}
          </span>
          <span className="text-muted mono">de {formatCurrency(goal.target)}</span>
        </div>
        <div className="progress" style={{ height: 11 }}>
          <div
            className="progress-bar"
            style={{
              width: `${Math.min(100, percent)}%`,
              background: done ? 'var(--income)' : goal.color,
            }}
          />
        </div>
        <div className="row-between text-xs text-muted" style={{ marginTop: 7, gap: 8 }}>
          <span>{formatPercent(percent, 1)} concluído</span>
          {done ? (
            <span className="text-income fw-600 row" style={{ gap: 5 }}>
              <PartyPopper size={12} strokeWidth={2.2} />
              Meta alcançada!
            </span>
          ) : (
            <span>Faltam {formatCurrency(remaining)}</span>
          )}
        </div>
      </div>

      {!done && left !== null && (
        <div className={`insight ${left <= 0 ? 'danger' : left <= 2 ? 'warning' : 'info'}`}>
          <span className="insight-icon">
            {left <= 0 ? (
              <CalendarClock size={16} strokeWidth={2} />
            ) : (
              <Lightbulb size={16} strokeWidth={2} />
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="insight-title">
              {left <= 0
                ? 'Prazo vencido'
                : `Guarde ${formatCurrency(perMonth)} por mês`}
            </div>
            <div className="insight-text">
              {left <= 0
                ? 'Reveja o prazo ou aumente os aportes.'
                : `Faltam ${left} ${left === 1 ? 'mês' : 'meses'} para o prazo.`}
            </div>
          </div>
        </div>
      )}

      <form className="row" onSubmit={contribute}>
        <input
          className="input mono grow"
          placeholder="Aportar R$..."
          value={contribution}
          onChange={(e) => setContribution(e.target.value)}
          inputMode="decimal"
          aria-label={`Aportar valor na meta ${goal.name}`}
        />
        <button className="btn btn-primary btn-sm" type="submit">
          <Plus size={15} strokeWidth={2.2} />
          Aportar
        </button>
      </form>
    </div>
  )
}

export default function GoalsPanel({ goals, onAdd, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const totalTarget = goals.reduce((s, g) => s + g.target, 0)
  const totalCurrent = goals.reduce((s, g) => s + g.current, 0)
  const totalPercent = totalTarget > 0 ? (totalCurrent / totalTarget) * 100 : 0

  const handleSave = (data) => {
    if (editing) onUpdate(editing.id, data)
    else onAdd(data)
    setShowForm(false)
    setEditing(null)
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            <div className="card-title">Metas de economia</div>
            <div className="card-sub">
              {goals.length
                ? `${formatCurrency(totalCurrent)} guardados de ${formatCurrency(totalTarget)} (${formatPercent(totalPercent)})`
                : 'Defina objetivos e acompanhe seu progresso'}
            </div>
          </div>
          {!showForm && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditing(null)
                setShowForm(true)
              }}
            >
              <Plus size={15} strokeWidth={2.2} />
              Nova meta
            </button>
          )}
        </div>

        {goals.length > 0 && (
          <div className="progress" style={{ height: 12 }}>
            <div
              className="progress-bar ok"
              style={{ width: `${Math.min(100, totalPercent)}%` }}
            />
          </div>
        )}
      </div>

      {showForm && (
        <GoalForm
          initial={
            editing
              ? {
                  ...editing,
                  target: String(editing.target),
                  current: String(editing.current),
                }
              : null
          }
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false)
            setEditing(null)
          }}
        />
      )}

      {goals.length === 0 && !showForm ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <Trophy size={22} strokeWidth={1.6} />
            </div>
            <div className="empty-title">Nenhuma meta cadastrada</div>
            <div className="text-sm">
              Crie metas como reserva de emergência, viagem ou troca de carro.
            </div>
          </div>
        </div>
      ) : (
        <div className="grid-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onEdit={(g) => {
                setEditing(g)
                setShowForm(true)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
