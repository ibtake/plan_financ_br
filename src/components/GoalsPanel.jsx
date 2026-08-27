import { useState } from 'react'
import { AlertTriangle, CircleHelp, Pencil, Plus, Trash2, Trophy, X } from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import { amountToInput, formatAmountInput, formatCurrency, formatDate, formatPercent, monthLabelShort, monthsBehind, parseAmount, todayISO } from '../utils/format.js'
import { useDialog } from '../hooks/useDialog.js'

const ICONS = ['🎯', '✈️', '🏠', '🚗', '💻', '🎓', '💍', '🏖️', '📱', '🎁']
const COLORS = ['#6366f1', '#22c55e', '#0ea5e9', '#f97316', '#ec4899', '#8b5cf6']

function GoalForm({ initial, onSave, onCancel }) {
  const [reverse, setReverse] = useState(initial?.goalType === 'reverse')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(initial ? { ...initial, target: amountToInput(initial.target), current: amountToInput(initial.current), originalAmount: amountToInput(initial.originalAmount), initialContribution: amountToInput(initial.initialContribution) } : { name: '', target: '', current: '', deadline: '', icon: '🎯', color: '#6366f1', originalAmount: '', initialContribution: '', startDate: new Date().toISOString().slice(0, 10), selicFactor: 1 })
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
      <div className="field span-2"><label className="label">Nome *</label><input name="goal-name" className="input" value={form.name} onChange={(event) => set({ name: event.target.value })} required /></div>
      {reverse ? <>
        <div className="field"><label className="label">Valor inicial *</label><input name="goal-original-amount" className="input mono" value={form.originalAmount} onChange={(event) => set({ originalAmount: formatAmountInput(event.target.value) })} inputMode="numeric" /></div>
        <div className="field"><label className="label">Já recomposto</label><input name="goal-initial-contribution" className="input mono" value={form.initialContribution} onChange={(event) => set({ initialContribution: formatAmountInput(event.target.value) })} inputMode="numeric" /></div>
        <div className="field"><label className="label">Data de início *</label><input name="goal-start-date" className="input goal-date-input" type="date" value={form.startDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => set({ startDate: event.target.value })} /></div>
        <div className="field"><label className="label">Fator Selic</label><div className="factor-stepper"><button type="button" aria-label="Diminuir fator Selic" onClick={() => set({ selicFactor: Math.max(.5, Number(form.selicFactor) - .005) })}>−</button><strong>{formatPercent(Number(form.selicFactor) * 100, 1)}</strong><button type="button" aria-label="Aumentar fator Selic" onClick={() => set({ selicFactor: Math.min(1.5, Number(form.selicFactor) + .005) })}>+</button></div></div>
      </> : <>
        <div className="field"><label className="label">Valor alvo *</label><input name="goal-target" className="input mono" value={form.target} onChange={(event) => set({ target: formatAmountInput(event.target.value) })} inputMode="numeric" /></div>
        <div className="field"><label className="label">Já guardado</label><input name="goal-current" className="input mono" value={form.current} onChange={(event) => set({ current: formatAmountInput(event.target.value) })} inputMode="numeric" readOnly={Boolean(initial)} /><small className="text-xs text-muted">{initial ? 'Edite os aportes em Mais detalhes.' : ''}</small></div>
        <div className="field"><label className="label">Prazo</label><input name="goal-deadline" className="input goal-date-input" type="date" value={form.deadline} onChange={(event) => set({ deadline: event.target.value })} /></div>
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
    <div className="form-grid"><div className="field span-2"><label className="label">Nome *</label><input name="reverse-goal-name" className="input" value={form.name} onChange={(event) => set({ name: event.target.value })} required autoFocus /></div><div className="field span-2"><label className="label">Ícone e cor</label><div className="swatch-grid">{ICONS.map((icon) => <button type="button" className={`swatch${form.icon === icon ? ' selected' : ''}`} onClick={() => set({ icon })} key={icon}><AppIcon emoji={icon} /></button>)}</div><div className="swatch-grid">{COLORS.map((color) => <button type="button" className={`color-dot${form.color === color ? ' selected' : ''}`} onClick={() => set({ color })} style={{ background: color }} key={color} />)}</div></div></div>
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar alterações'}</button></div>
  </form>
}

function ContributionModal({ goal, onSave, onClose, title = 'Registrar aporte', amountName = 'contribution-amount', dateName = 'contribution-date', dateLabel = 'Data do aporte', minDate }) {
  const [amount, setAmount] = useState('')
  const [occurredOn, setOccurredOn] = useState(todayISO())
  const { closing, close, surfaceRef } = useDialog(onClose)
  const submit = async (event) => { event.preventDefault(); if (await onSave(goal.id, { amount: parseAmount(amount), occurredOn })) close() }
  return <div className={`reverse-modal-backdrop${closing ? ' is-closing' : ''}`} onMouseDown={close} role="presentation"><form ref={surfaceRef} className={`reverse-details aporte-modal${closing ? ' is-closing' : ''}`} onMouseDown={(event) => event.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-label={title}><div className="row-between"><strong>{title}</strong><button type="button" className="icon-btn" onClick={close} aria-label="Fechar"><X size={18} /></button></div><label className="label">Valor *</label><input name={amountName} className="input mono aporte-value" value={amount} onChange={(event) => setAmount(formatAmountInput(event.target.value))} inputMode="numeric" required autoFocus /><label className="label">{dateLabel} *</label><input name={dateName} className="input" type="date" min={minDate} max={todayISO()} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /><button className="btn btn-primary">Salvar aporte</button></form></div>
}

const StandardAporteModal = ContributionModal

function EditContributionModal({ item, minDate, onSave, onClose }) {
  const [amount, setAmount] = useState(amountToInput(item.amount))
  const [occurredOn, setOccurredOn] = useState(item.occurredOn || '')
  const [saving, setSaving] = useState(false)
  const { closing, close, surfaceRef } = useDialog(onClose, true, saving)

  const submit = async (event) => {
    event.preventDefault()
    const parsedAmount = parseAmount(amount)
    if (parsedAmount <= 0 || !occurredOn) return
    setSaving(true)
    const ok = await onSave(item.id, { amount: parsedAmount, occurredOn })
    setSaving(false)
    if (ok) close()
  }

  return <div className={`reverse-modal-backdrop${closing ? ' is-closing' : ''}`} onMouseDown={close} role="presentation">
    <form ref={surfaceRef} className={`reverse-details aporte-modal${closing ? ' is-closing' : ''}`} onMouseDown={(event) => event.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="edit-contribution-title">
      <div className="row-between"><strong id="edit-contribution-title">Editar aporte</strong><button type="button" className="icon-btn" onClick={close} disabled={saving} aria-label="Fechar"><X size={18} /></button></div>
      <label className="label" htmlFor="edit-contribution-amount">Valor *</label>
      <input id="edit-contribution-amount" name="edit-contribution-amount" className="input mono aporte-value" value={amount} onChange={(event) => setAmount(formatAmountInput(event.target.value))} inputMode="numeric" required autoFocus disabled={saving} />
      <label className="label" htmlFor="edit-contribution-date">Data do aporte *</label>
      <input id="edit-contribution-date" name="edit-contribution-date" className="input" type="date" min={minDate} max={todayISO()} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required disabled={saving} />
      <button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
    </form>
  </div>
}

function ReverseCard({ goal, onAporte, onEdit, onDelete, history = [], contributions = [], onUpdateContribution, isDeleting }) {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState(false)
  const [details, setDetails] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const detailsDialog = useDialog(() => setDetails(false), details)
  const progress = Math.min(100, Math.max(0, Number(goal.reverseProgressPercent) || 0))
  const completed = Boolean(goal.reverseCompletedAt || goal.reverseRemainingAmount <= 0)
  // Selic congelada nao inventa valor: rebuild_reverse_goal_for_user faz
  // `exit when not found` no primeiro mes sem taxa (schema.sql:1699) e depois
  // segue abatendo os aportes sem correcao nenhuma (:1714), entao o restante
  // aparece MENOR que o real - erro a favor da sensacao de progresso, o tipo
  // que ninguem estranha. Sem leitura nova: o historico da meta ja esta em
  // memoria (financeLoader.js:11-15). Sem correcao nenhuma a referencia e o
  // mes de inicio, senao tabela vazia (cron que nunca rodou) passaria batido.
  // Corte em 2 meses porque a serie 4390 do BCB publica o mes fechado com
  // alguns dias de atraso; 1 mes acusaria todo comeco de mes.
  const lastCorrected = history.length
    ? history.map((item) => String(item.reference_month)).sort().at(-1)
    : String(goal.reverseStartDate || '')
  const correctionLag = completed ? 0 : monthsBehind(lastCorrected)
  const items = [...history.map((item) => ({ ...item, t: 'Correção mensal', d: item.applied_on, v: item.correction_amount })), ...contributions.map((item) => ({ ...item, t: 'Aporte', d: item.occurred_on, v: item.amount }))].sort((a, b) => String(b.d).localeCompare(String(a.d)))
  const editContribution = (item) => setEditingItem({ id: item.id, amount: item.v, occurredOn: item.d })
  const toggleFromCard = (event) => { if (!event.target.closest('button, input, select, textarea, form, .reverse-modal-backdrop')) setOpen((current) => !current) }

  return <div className={`goal-card goal-card-expandable reverse-goal-card${completed ? ' goal-completed' : ''}`} onClick={toggleFromCard}>
    <div className="row-between"><button className="reverse-card-main" onClick={() => setOpen(!open)} disabled={isDeleting}><span className="goal-icon" style={{ background: `${goal.color}22`, color: goal.color }}><AppIcon emoji={goal.icon} /></span><span><strong>{goal.name}</strong><small className="goal-badge reverse-badge">Meta Reversa</small></span></button><div className="row"><button className="icon-btn" aria-label="Editar meta reversa" onClick={() => onEdit(goal)} disabled={isDeleting}><Pencil size={15} /></button><button className="icon-btn danger" aria-label="Excluir meta" disabled={isDeleting} onClick={async () => { if (window.confirm('Excluir esta meta e seu histórico?')) await onDelete(goal.id) }}><Trash2 size={15} /></button></div></div>
    <div className="progress"><div className="progress-bar" style={{ width: `${progress}%`, background: goal.color }} /></div>
    <div className="completion-status text-xs"><span>{formatPercent(progress, 1)} concluído</span>{completed && <span className="completion-trophy" role="img" aria-label="Meta concluída">🏆</span>}</div>
    {correctionLag >= 2 && <div className="notice warning text-xs"><AlertTriangle size={13} strokeWidth={2.2} /> Correção pela Selic sem atualização desde {monthLabelShort(lastCorrected)}. O valor restante está menor que o real até a próxima sincronização.</div>}
    {open && <><div className="reverse-summary"><span>Original<strong>{formatCurrency(goal.reverseOriginalAmount)}</strong></span><span>Aportado<strong>{formatCurrency(goal.reverseTotalContributed)}</strong></span><span>Correção<strong>{formatCurrency(goal.reverseCorrectionAmount)}</strong></span><span>Restante<strong>{formatCurrency(goal.reverseRemainingAmount)}</strong></span></div><p className="muted">{goal.reverseForecastCompletionDate ? `Previsão de conclusão: ${formatDate(goal.reverseForecastCompletionDate)} (média mensal: ${formatCurrency(goal.reverseMonthlyContributionAverage)})` : 'A previsão aparecerá após os aportes criarem uma média mensal.'}</p>{goal.reverseRemainingAmount > 0 && <button className="btn btn-primary" onClick={() => setModal(true)} disabled={isDeleting}>Fazer aporte</button>}<button className="btn btn-sm" type="button" onClick={() => setDetails(true)} disabled={isDeleting}>Mais detalhes</button></>}
    {modal && <ContributionModal goal={goal} title="Fazer aporte" amountName="reverse-contribution-amount" dateName="reverse-contribution-date" dateLabel="Data real" minDate={goal.reverseStartDate} onSave={onAporte} onClose={() => setModal(false)} />}
    {editingItem && <EditContributionModal item={editingItem} minDate={goal.reverseStartDate} onSave={onUpdateContribution} onClose={() => setEditingItem(null)} />}
    {details && <div className={`reverse-modal-backdrop${detailsDialog.closing ? ' is-closing' : ''}`} onMouseDown={detailsDialog.close} role="presentation"><section ref={detailsDialog.surfaceRef} className={`reverse-details${detailsDialog.closing ? ' is-closing' : ''}`} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="reverse-details-title"><div className="row-between"><strong id="reverse-details-title">Mais detalhes</strong><button className="icon-btn" aria-label="Fechar" onClick={detailsDialog.close}><X size={18} /></button></div><div className="reverse-timeline">{items.length ? items.map((item, index) => <article className={item.t === 'Aporte' ? 'reverse-timeline-contribution' : ''} key={`${item.t}-${item.id || item.d}-${index}`}><div className="reverse-timeline-info"><strong>{formatDate(item.d)} · {item.t}</strong>{item.v !== undefined && <p>{formatCurrency(Number(item.v))}</p>}</div>{item.t === 'Aporte' && <button className="btn btn-sm reverse-timeline-edit" aria-label="Editar aporte" onClick={() => editContribution(item)} disabled={isDeleting}><Pencil size={15} /><span className="reverse-timeline-edit-label">Editar aporte</span></button>}</article>) : <p className="muted">Ainda não há movimentações nesta meta.</p>}</div></section></div>}
  </div>
}

function StandardCard({ goal, contributions = [], onAddContribution, onUpdateContribution, onEdit, onDelete, isDeleting }) {
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState(false)
  const [details, setDetails] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const detailsDialog = useDialog(() => setDetails(false), details)
  const progress = goal.target ? goal.current / goal.target * 100 : 0
  const completed = goal.current >= goal.target
  const items = [...contributions].sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || Number(b.id) - Number(a.id))
  const editContribution = (item) => setEditingItem({ id: item.id, amount: item.amount, occurredOn: item.occurred_on })
  const toggleFromCard = (event) => { if (!event.target.closest('button, input, select, textarea, form')) setOpen((current) => !current) }
  return <div className={`goal-card goal-card-expandable${completed ? ' goal-completed' : ''}`} onClick={toggleFromCard}><div className="row-between"><button className="standard-card-main" onClick={() => setOpen(!open)} disabled={isDeleting}><div className="goal-icon" style={{ background: `${goal.color}22`, color: goal.color }}><AppIcon emoji={goal.icon} /></div><span><strong>{goal.name}</strong><small className="goal-badge standard-badge">Meta</small></span></button><div className="row"><button className="icon-btn" onClick={() => onEdit(goal)} disabled={isDeleting}><Pencil size={15} /></button><button className="icon-btn danger" disabled={isDeleting} onClick={async () => { if (window.confirm('Excluir esta meta?')) await onDelete(goal.id) }}><Trash2 size={15} /></button></div></div><div className="progress"><div className="progress-bar" style={{ width: `${Math.min(100, progress)}%`, background: goal.color }} /></div><div className="completion-status text-xs"><span>{formatPercent(progress, 1)} concluído</span>{completed && <span className="completion-trophy" role="img" aria-label="Meta concluída">🏆</span>}</div>{open && <><div className="standard-summary"><span>Valor da meta<strong>{formatCurrency(goal.target)}</strong></span><span>Já aportado<strong>{formatCurrency(goal.current)}</strong></span></div>{!completed && <button className="btn btn-primary" onClick={() => setModal(true)} disabled={isDeleting}><Plus size={15} />Aportar</button>}<button className="btn btn-sm" type="button" onClick={() => setDetails(true)} disabled={isDeleting}>Mais detalhes</button></>}{modal && <StandardAporteModal goal={goal} onSave={onAddContribution} onClose={() => setModal(false)} />}{editingItem && <EditContributionModal item={editingItem} onSave={onUpdateContribution} onClose={() => setEditingItem(null)} />}{details && <div className={`reverse-modal-backdrop${detailsDialog.closing ? ' is-closing' : ''}`} onMouseDown={detailsDialog.close} role="presentation"><section ref={detailsDialog.surfaceRef} className={`reverse-details${detailsDialog.closing ? ' is-closing' : ''}`} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="reverse-details-title"><div className="row-between"><strong id="reverse-details-title">Mais detalhes</strong><button className="icon-btn" aria-label="Fechar" onClick={detailsDialog.close}><X size={18} /></button></div><div className="reverse-timeline">{items.length ? items.map((item) => <article className="reverse-timeline-contribution" key={item.id}><div className="reverse-timeline-info"><strong>{formatDate(item.occurred_on)} · Aporte</strong><p>{formatCurrency(Number(item.amount))}{item.note && ` · ${item.note}`}</p></div><button className="btn btn-sm reverse-timeline-edit" aria-label="Editar aporte" onClick={() => editContribution(item)} disabled={isDeleting}><Pencil size={15} /><span className="reverse-timeline-edit-label">Editar aporte</span></button></article>) : <p className="muted">Ainda não há aportes nesta meta.</p>}</div></section></div>}</div>
}

export default function GoalsPanel({ goals, reverseHistory, reverseContributions, standardContributions, onAdd, onAddReverse, onAddReverseContribution, onUpdateReverseContribution, onAddStandardContribution, onUpdateStandardContribution, onUpdate, onUpdateReverse, onDelete, isDeleting }) {
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editingReverse, setEditingReverse] = useState(null)
  const save = (data) => data.goalType === 'reverse' ? onAddReverse(data) : (editing ? onUpdate(editing.id, data) : onAdd(data))
  const saveReverse = async (data) => onUpdateReverse(editingReverse.id, data)

  return <div className="stack"><div className="card row-between"><div><div className="card-title">Metas de economia</div><div className="card-sub">Crie metas normais ou reversas</div></div><button className="btn btn-primary" onClick={() => { setEditing(null); setEditingReverse(null); setShow(true) }} disabled={isDeleting}><Plus size={15} />Nova meta</button></div>{show && <GoalForm initial={editing} onSave={save} onCancel={() => { setShow(false); setEditing(null) }} />}{editingReverse && <ReverseMetadataForm initial={editingReverse} onSave={saveReverse} onCancel={() => setEditingReverse(null)} />}{goals.length ? <div className="grid-3 goals-grid">{goals.map((goal) => goal.goalType === 'reverse' ? <ReverseCard key={goal.id} goal={goal} history={reverseHistory.filter((item) => item.goal_id === goal.id)} contributions={reverseContributions.filter((item) => item.goal_id === goal.id)} onAporte={onAddReverseContribution} onUpdateContribution={onUpdateReverseContribution} onEdit={setEditingReverse} onDelete={onDelete} isDeleting={isDeleting} /> : <StandardCard key={goal.id} goal={goal} contributions={standardContributions.filter((item) => item.goal_id === goal.id)} onAddContribution={onAddStandardContribution} onUpdateContribution={onUpdateStandardContribution} onEdit={(item) => { setEditingReverse(null); setEditing(item); setShow(true) }} onDelete={onDelete} isDeleting={isDeleting} />)}</div> : !show && !editingReverse && <div className="card empty"><Trophy />Nenhuma meta cadastrada</div>}</div>
}
