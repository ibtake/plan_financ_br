import { useState } from 'react'
import { CircleHelp, Pencil, Plus, Trash2, Trophy, X } from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import { formatCurrency, formatDate, formatPercent, parseAmount } from '../utils/format.js'

const ICONS = ['🎯', '✈️', '🏠', '🚗', '💻', '🎓', '💍', '🏖️', '📱', '🎁']
const COLORS = ['#6366f1', '#22c55e', '#0ea5e9', '#f97316', '#ec4899', '#8b5cf6']

function GoalForm({ initial, onSave, onCancel }) {
  const [reverse, setReverse] = useState(initial?.goalType === 'reverse')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(initial || { name: '', target: '', current: '', deadline: '', icon: '🎯', color: '#6366f1', originalAmount: '', initialContribution: '', startDate: new Date().toISOString().slice(0, 10), selicFactor: 1 })
  const set = (patch) => setForm((value) => ({ ...value, ...patch }))
  const submit = async (event) => {
    event.preventDefault()
    const data = reverse
      ? { ...form, goalType: 'reverse', originalAmount: parseAmount(form.originalAmount), initialContribution: parseAmount(form.initialContribution), selicFactor: Number(form.selicFactor) || 1 }
      : { ...form, goalType: 'standard', target: parseAmount(form.target), current: parseAmount(form.current) }
    if (!data.name.trim() || (reverse ? !data.originalAmount || !data.startDate : !data.target)) return
    setBusy(true)
    const ok = await onSave(data)
    setBusy(false)
    if (ok !== false) onCancel()
  }

  return <form className="card" onSubmit={submit}>
    <div className="row-between"><div><strong>Esta meta é Reversa?</strong><div className="text-xs text-muted">Recomposição corrigida pela Selic.</div></div><button type="button" className={`goal-switch${reverse ? ' active' : ''}`} onClick={() => setReverse(!reverse)} role="switch" aria-checked={reverse}><span /></button></div>
    {reverse && <details className="reverse-help" open><summary><CircleHelp size={16} /> Como funciona?</summary><p>O saldo restante é corrigido pela Selic até chegar a zero.</p></details>}
    <div className="form-grid" style={{ marginTop: 16 }}>
      <div className="field span-2"><label className="label">Nome *</label><input className="input" value={form.name} onChange={(event) => set({ name: event.target.value })} required /></div>
      {reverse ? <>
        <div className="field"><label className="label">Valor inicial *</label><input className="input mono" value={form.originalAmount} onChange={(event) => set({ originalAmount: event.target.value })} inputMode="decimal" /></div>
        <div className="field"><label className="label">Já recomposto</label><input className="input mono" value={form.initialContribution} onChange={(event) => set({ initialContribution: event.target.value })} inputMode="decimal" /></div>
        <div className="field"><label className="label">Data de início *</label><input className="input goal-date-input" type="date" value={form.startDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => set({ startDate: event.target.value })} /></div>
        <div className="field"><label className="label">Fator Selic</label><div className="factor-stepper"><button type="button" aria-label="Diminuir fator Selic" onClick={() => set({ selicFactor: Math.max(.5, Number(form.selicFactor) - .005) })}>−</button><strong>{formatPercent(Number(form.selicFactor) * 100, 1)}</strong><button type="button" aria-label="Aumentar fator Selic" onClick={() => set({ selicFactor: Math.min(1.5, Number(form.selicFactor) + .005) })}>+</button></div></div>
      </> : <>
        <div className="field"><label className="label">Valor alvo *</label><input className="input mono" value={form.target} onChange={(event) => set({ target: event.target.value })} inputMode="decimal" /></div>
        <div className="field"><label className="label">Já guardado</label><input className="input mono" value={form.current} onChange={(event) => set({ current: event.target.value })} inputMode="decimal" /></div>
        <div className="field"><label className="label">Prazo</label><input className="input goal-date-input" type="date" value={form.deadline} onChange={(event) => set({ deadline: event.target.value })} /></div>
      </>}
      <div className="field span-2"><label className="label">Ícone e cor</label><div className="swatch-grid">{ICONS.map((icon) => <button type="button" className={`swatch${form.icon === icon ? ' selected' : ''}`} onClick={() => set({ icon })} key={icon}><AppIcon emoji={icon} /></button>)}</div><div className="swatch-grid">{COLORS.map((color) => <button type="button" className={`color-dot${form.color === color ? ' selected' : ''}`} onClick={() => set({ color })} style={{ background: color }} key={color} />)}</div></div>
    </div>
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn" type="button" onClick={onCancel}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar meta'}</button></div>
  </form>
}

function ReverseMetadataForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ name: initial.name, icon: initial.icon, color: initial.color })
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((value) => ({ ...value, ...patch }))
  const submit = async (event) => {
    event.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    const ok = await onSave(form)
    setBusy(false)
    if (ok) onCancel()
  }

  return <form className="card" onSubmit={submit}>
    <div className="card-head"><div><div className="card-title">Editar Meta Reversa</div><div className="card-sub">Nome, ícone e cor não alteram os cálculos.</div></div></div>
    <div className="form-grid"><div className="field span-2"><label className="label">Nome *</label><input className="input" value={form.name} onChange={(event) => set({ name: event.target.value })} required autoFocus /></div><div className="field span-2"><label className="label">Ícone e cor</label><div className="swatch-grid">{ICONS.map((icon) => <button type="button" className={`swatch${form.icon === icon ? ' selected' : ''}`} onClick={() => set({ icon })} key={icon}><AppIcon emoji={icon} /></button>)}</div><div className="swatch-grid">{COLORS.map((color) => <button type="button" className={`color-dot${form.color === color ? ' selected' : ''}`} onClick={() => set({ color })} style={{ background: color }} key={color} />)}</div></div></div>
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar alterações'}</button></div>
  </form>
}

function AporteModal({ goal, onSave, onClose }) {
  const [amount, setAmount] = useState('')
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10))
  const submit = async (event) => { event.preventDefault(); if (await onSave(goal.id, { amount: parseAmount(amount), occurredOn })) onClose() }
  return <div className="reverse-modal-backdrop" onMouseDown={onClose}><form className="reverse-details aporte-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}><div className="row-between"><strong>Fazer aporte</strong><button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button></div><label className="label">Valor *</label><input className="input mono aporte-value" value={amount} onChange={(event) => setAmount(event.target.value)} required autoFocus /><label className="label">Data real *</label><input className="input" type="date" min={goal.reverseStartDate} max={new Date().toISOString().slice(0, 10)} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /><button className="btn btn-primary">Salvar aporte</button></form></div>
}

function ReverseCard({ goal, onAporte, onEdit, onDelete, history = [], contributions = [], events = [], onUpdateContribution, isDeleting }) {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState(false)
  const [details, setDetails] = useState(false)
  const progress = Math.min(100, Math.max(0, Number(goal.reverseProgressPercent) || 0))
  const completed = Boolean(goal.reverseCompletedAt || goal.reverseRemainingAmount <= 0)
  const items = [...history.map((item) => ({ ...item, t: 'Correção mensal', d: item.applied_on, v: item.correction_amount })), ...contributions.map((item) => ({ ...item, t: 'Aporte', d: item.occurred_on, v: item.amount }))].sort((a, b) => String(b.d).localeCompare(String(a.d)))
  const editContribution = (item) => { const amount = window.prompt('Novo valor do aporte', item.v); if (amount === null) return; const occurredOn = window.prompt('Data do aporte (AAAA-MM-DD)', item.d); if (occurredOn === null) return; onUpdateContribution(item.id, { amount: parseAmount(amount), occurredOn }) }
  const toggleFromCard = (event) => { if (!event.target.closest('button, input, select, textarea, form, .reverse-modal-backdrop')) setOpen((current) => !current) }

  return <div className={`goal-card goal-card-expandable reverse-goal-card${completed ? ' goal-completed' : ''}`} onClick={toggleFromCard}>
    <div className="row-between"><button className="reverse-card-main" onClick={() => setOpen(!open)} disabled={isDeleting}><span className="goal-icon" style={{ background: `${goal.color}22`, color: goal.color }}><AppIcon emoji={goal.icon} /></span><span><strong>{goal.name}</strong><small className="goal-badge reverse-badge">Meta Reversa</small></span></button><div className="row"><button className="icon-btn" aria-label="Editar meta reversa" onClick={() => onEdit(goal)} disabled={isDeleting}><Pencil size={15} /></button><button className="icon-btn danger" aria-label="Excluir meta" disabled={isDeleting} onClick={async () => { if (window.confirm('Excluir esta meta e seu histórico?')) await onDelete(goal.id) }}><Trash2 size={15} /></button></div></div>
    <div className="progress"><div className="progress-bar" style={{ width: `${progress}%`, background: goal.color }} /></div>
    <div className="completion-status text-xs"><span>{formatPercent(progress, 1)} concluído</span>{completed && <span className="completion-trophy" role="img" aria-label="Meta concluída">🏆</span>}</div>
    {open && <><div className="reverse-summary"><span>Original<strong>{formatCurrency(goal.reverseOriginalAmount)}</strong></span><span>Aportado<strong>{formatCurrency(goal.reverseTotalContributed)}</strong></span><span>Correção<strong>{formatCurrency(goal.reverseCorrectionAmount)}</strong></span><span>Restante<strong>{formatCurrency(goal.reverseRemainingAmount)}</strong></span></div><p className="muted">{goal.reverseForecastCompletionDate ? `Previsão de conclusão: ${formatDate(goal.reverseForecastCompletionDate)} (média mensal: ${formatCurrency(goal.reverseMonthlyContributionAverage)})` : 'A previsão aparecerá após os aportes criarem uma média mensal.'}</p>{goal.reverseRemainingAmount > 0 && <button className="btn btn-primary" onClick={() => setModal(true)} disabled={isDeleting}>Fazer aporte</button>}<button className="btn btn-sm" type="button" onClick={() => setDetails(true)} disabled={isDeleting}>Mais detalhes</button></>}
    {modal && <AporteModal goal={goal} onSave={onAporte} onClose={() => setModal(false)} />}
    {details && <div className="reverse-modal-backdrop" onMouseDown={() => setDetails(false)}><section className="reverse-details" onMouseDown={(event) => event.stopPropagation()}><div className="row-between"><strong>Mais detalhes</strong><button className="icon-btn" aria-label="Fechar" onClick={() => setDetails(false)}><X size={18} /></button></div><div className="reverse-timeline">{items.length ? items.map((item, index) => <article className={item.t === 'Aporte' ? 'reverse-timeline-contribution' : ''} key={`${item.t}-${item.id || item.d}-${index}`}><div className="reverse-timeline-info"><strong>{formatDate(item.d)} · {item.t}</strong>{item.v !== undefined && <p>{formatCurrency(Number(item.v))}</p>}</div>{item.t === 'Aporte' && <button className="btn btn-sm reverse-timeline-edit" aria-label="Editar aporte" onClick={() => editContribution(item)} disabled={isDeleting}><Pencil size={15} /><span className="reverse-timeline-edit-label">Editar aporte</span></button>}</article>) : <p className="muted">Ainda não há movimentações nesta meta.</p>}</div></section></div>}
  </div>
}

function StandardCard({ goal, onUpdate, onEdit, onDelete, isDeleting }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const progress = goal.target ? goal.current / goal.target * 100 : 0
  const completed = goal.current >= goal.target
  const toggleFromCard = (event) => { if (!event.target.closest('button, input, select, textarea, form')) setOpen((current) => !current) }
  return <div className={`goal-card goal-card-expandable${completed ? ' goal-completed' : ''}`} onClick={toggleFromCard}><div className="row-between"><button className="standard-card-main" onClick={() => setOpen(!open)} disabled={isDeleting}><div className="goal-icon" style={{ background: `${goal.color}22`, color: goal.color }}><AppIcon emoji={goal.icon} /></div><span><strong>{goal.name}</strong><small className="goal-badge standard-badge">Meta</small></span></button><div className="row"><button className="icon-btn" onClick={() => onEdit(goal)} disabled={isDeleting}><Pencil size={15} /></button><button className="icon-btn danger" disabled={isDeleting} onClick={async () => { if (window.confirm('Excluir esta meta?')) await onDelete(goal.id) }}><Trash2 size={15} /></button></div></div><div className="progress"><div className="progress-bar" style={{ width: `${Math.min(100, progress)}%`, background: goal.color }} /></div><div className="completion-status text-xs"><span>{formatPercent(progress, 1)} concluído</span>{completed && <span className="completion-trophy" role="img" aria-label="Meta concluída">🏆</span>}</div>{open && <form className="row" onSubmit={(event) => { event.preventDefault(); const value = parseAmount(amount); if (value) { onUpdate(goal.id, { current: goal.current + value }); setAmount('') } }}><input className="input mono grow" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Aportar R$..." disabled={isDeleting} /><button className="btn btn-primary btn-sm" disabled={isDeleting}><Plus size={15} />Aportar</button></form>}</div>
}

export default function GoalsPanel({ goals, reverseHistory, reverseContributions, reverseEvents, onAdd, onAddReverse, onAddReverseContribution, onUpdateReverseContribution, onUpdate, onUpdateReverse, onDelete, isDeleting }) {
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editingReverse, setEditingReverse] = useState(null)
  const save = (data) => data.goalType === 'reverse' ? onAddReverse(data) : (editing ? onUpdate(editing.id, data) : onAdd(data))
  const saveReverse = async (data) => onUpdateReverse(editingReverse.id, data)

  return <div className="stack"><div className="card row-between"><div><div className="card-title">Metas de economia</div><div className="card-sub">Crie metas normais ou reversas</div></div><button className="btn btn-primary" onClick={() => { setEditing(null); setEditingReverse(null); setShow(true) }} disabled={isDeleting}><Plus size={15} />Nova meta</button></div>{show && <GoalForm initial={editing ? { ...editing, target: String(editing.target), current: String(editing.current) } : null} onSave={save} onCancel={() => { setShow(false); setEditing(null) }} />}{editingReverse && <ReverseMetadataForm initial={editingReverse} onSave={saveReverse} onCancel={() => setEditingReverse(null)} />}{goals.length ? <div className="grid-3">{goals.map((goal) => goal.goalType === 'reverse' ? <ReverseCard key={goal.id} goal={goal} history={reverseHistory.filter((item) => item.goal_id === goal.id)} contributions={reverseContributions.filter((item) => item.goal_id === goal.id)} events={reverseEvents.filter((item) => item.goal_id === goal.id)} onAporte={onAddReverseContribution} onUpdateContribution={onUpdateReverseContribution} onEdit={setEditingReverse} onDelete={onDelete} isDeleting={isDeleting} /> : <StandardCard key={goal.id} goal={goal} onUpdate={onUpdate} onEdit={(item) => { setEditingReverse(null); setEditing(item); setShow(true) }} onDelete={onDelete} isDeleting={isDeleting} />)}</div> : !show && !editingReverse && <div className="card empty"><Trophy />Nenhuma meta cadastrada</div>}</div>
}
