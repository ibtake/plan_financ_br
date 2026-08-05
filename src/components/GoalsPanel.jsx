import { useState } from 'react'
import AppIcon from './AppIcon.jsx'
import { formatCurrency, formatDate, formatPercent, parseAmount } from '../utils/format.js'

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
        <div className="field">
          <label className="label">Ícone e cor</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
            {ICONS.map((ic) => (
              <button
                type="button"
                key={ic}
                className="icon-btn"
                onClick={() => set({ icon: ic })}
                style={{
                  background: form.icon === ic ? 'var(--primary-soft)' : 'transparent',
                  outline: form.icon === ic ? '2px solid var(--primary)' : 'none',
                }}
              >
                <AppIcon emoji={ic} />
              </button>
            ))}
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => set({ color: c })}
                aria-label={`Cor ${c}`}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: c,
                  border: form.color === c ? '3px solid var(--text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
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
      <div className="row-between">
        <div className="row">
          <div className="goal-icon" style={{ background: `${goal.color}22`, color: goal.color }}>
            <AppIcon emoji={goal.icon} />
          </div>
          <div>
            <div className="fw-600">{goal.name}</div>
            <div className="text-xs text-muted">
              {goal.deadline ? `Prazo: ${formatDate(goal.deadline)}` : 'Sem prazo definido'}
            </div>
          </div>
        </div>
        <div className="row">
          <button className="icon-btn" onClick={() => onEdit(goal)} title="Editar">
            ✏️
          </button>
          <button className="icon-btn danger" onClick={() => onDelete(goal.id)} title="Excluir">
            🗑️
          </button>
        </div>
      </div>

      <div>
        <div className="row-between text-sm" style={{ marginBottom: 6 }}>
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
        <div className="row-between text-xs text-muted" style={{ marginTop: 6 }}>
          <span>{formatPercent(percent, 1)} concluído</span>
          {done ? (
            <span className="text-income fw-600">🎉 Meta alcançada!</span>
          ) : (
            <span>Faltam {formatCurrency(remaining)}</span>
          )}
        </div>
      </div>

      {!done && left !== null && (
        <div className={`insight ${left <= 0 ? 'danger' : left <= 2 ? 'warning' : 'info'}`}>
          <span className="insight-icon">{left <= 0 ? '⏰' : '💡'}</span>
          <div>
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
        />
        <button className="btn btn-primary btn-sm" type="submit">
          ➕ Aportar
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
          <div>
            <div className="card-title">Metas de economia</div>
            <div className="card-sub">
              {goals.length
                ? `${formatCurrency(totalCurrent)} guardados de ${formatCurrency(totalTarget)} (${formatPercent(totalPercent)})`
                : 'Defina objetivos e acompanhe seu progresso'}
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
              ➕ Nova meta
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
            <div className="empty-icon">🏆</div>
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
