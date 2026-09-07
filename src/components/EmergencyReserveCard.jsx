import { useMemo, useState } from 'react'
import { LifeBuoy, AlertTriangle, SlidersHorizontal, X } from 'lucide-react'
import { computeEmergencyReserve } from '../utils/emergencyReserve.js'
import { formatCurrency, monthKeyFromDate, monthLabelShort, parseAmount, todayISO } from '../utils/format.js'

const RING_R = 50
const RING_C = 2 * Math.PI * RING_R // circunferência do traço (r=50)

/** Meses de folga em pt-BR com uma casa: 3,0 — ou "—" quando não dá pra calcular. */
function fmtMonths(value) {
  return value == null ? '—' : value.toFixed(1).replace('.', ',')
}

/**
 * Card da Reserva de emergência (IMPR-004) — vai na Visão geral, antes dos
 * Insights. Anel mostra quantos meses de despesa a reserva cobre; os números e
 * o aviso de correção saem do cálculo puro (emergencyReserve.js). Escrita da
 * meta/base via as RPCs expostas por useSupabaseFinance.
 */
export default function EmergencyReserveCard({ transactions, reserve, onSetTarget, onSetBaseline }) {
  const [editing, setEditing] = useState(false)
  const data = useMemo(() => computeEmergencyReserve(transactions, reserve || {}), [transactions, reserve])

  const { balance, burnRate, monthsOfSafety, targetMonths, progress, needsCorrection, baselineDate } = data
  const hasGoal = targetMonths != null
  const pct = progress ?? 0
  const dashoffset = RING_C * (1 - Math.max(0, Math.min(100, pct)) / 100)
  const reached = hasGoal && monthsOfSafety != null && monthsOfSafety >= targetMonths

  const cap = hasGoal
    ? `de ${targetMonths} ${targetMonths === 1 ? 'mês' : 'meses'}`
    : monthsOfSafety == null
      ? 'sem base de gasto'
      : 'meses hoje'

  return (
    <div className="card reserve-card">
      <div className="reserve-top">
        <div className="reserve-heading">
          <span className="reserve-icon" aria-hidden="true"><LifeBuoy size={18} strokeWidth={2.2} /></span>
          <div>
            <div className="card-title">Reserva de emergência</div>
            <div className="card-sub">quantos meses de gasto sua reserva cobre</div>
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          <SlidersHorizontal size={15} strokeWidth={2} />
          Ajustar
        </button>
      </div>

      <div className="reserve-body">
        <div className="reserve-ring" role="img" aria-label={hasGoal
          ? `Reserva cobre ${fmtMonths(monthsOfSafety)} de ${targetMonths} meses`
          : `Reserva cobre ${fmtMonths(monthsOfSafety)} meses`}>
          <svg viewBox="0 0 120 120">
            <defs>
              <linearGradient id="reserve-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--income)" />
                <stop offset="1" stopColor="var(--primary)" />
              </linearGradient>
            </defs>
            {hasGoal ? (
              <>
                <circle className="reserve-track" cx="60" cy="60" r={RING_R} strokeWidth="14" />
                <circle
                  cx="60" cy="60" r={RING_R} strokeWidth="14" fill="none" strokeLinecap="round"
                  stroke="url(#reserve-grad)" strokeDasharray={RING_C} strokeDashoffset={dashoffset}
                  transform="rotate(-90 60 60)"
                />
              </>
            ) : (
              <circle className="reserve-track dashed" cx="60" cy="60" r={RING_R} strokeWidth="14" strokeDasharray="3 9" strokeLinecap="round" />
            )}
          </svg>
          <div className="reserve-ring-center">
            <span className="reserve-num num">{fmtMonths(monthsOfSafety)}</span>
            <span className={`reserve-cap${hasGoal ? '' : ' muted'}`}>{cap}</span>
          </div>
        </div>

        <div className="reserve-figs">
          <div className="reserve-fig-row">
            <div>
              <div className="reserve-k">Saldo guardado</div>
              <div className="reserve-v num">{formatCurrency(balance)}</div>
            </div>
            <div>
              <div className="reserve-k">Gasto médio / mês</div>
              <div className="reserve-v small num">{burnRate == null ? '—' : formatCurrency(burnRate)}</div>
            </div>
          </div>

          {hasGoal && monthsOfSafety != null ? (
            <div>
              <p className="reserve-cover">
                {reached
                  ? <>Reserva completa — <b>meta de {targetMonths} {targetMonths === 1 ? 'mês' : 'meses'} atingida</b> 🛡️</>
                  : <>Cobre <b className="num">{fmtMonths(monthsOfSafety)}</b> de <b className="num">{targetMonths}</b> meses de segurança</>}
              </p>
              <div className="reserve-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className="reserve-progress-bar" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
              </div>
            </div>
          ) : (
            <p className="reserve-cover muted">
              {monthsOfSafety == null
                ? 'Registre despesas para calcular quantos meses a reserva cobre.'
                : 'Defina uma meta de meses para acompanhar o progresso.'}
            </p>
          )}
        </div>
      </div>

      {needsCorrection && (
        <div className="reserve-notice">
          <AlertTriangle size={16} strokeWidth={2.2} />
          <span>Correção manual pendente — sem atualização desde <b>{monthLabelShort(monthKeyFromDate(baselineDate))}</b>. Ajuste o saldo real para o cálculo continuar fiel.</span>
        </div>
      )}

      {editing && (
        <ReserveDialog
          reserve={reserve}
          balance={balance}
          onClose={() => setEditing(false)}
          onSetTarget={onSetTarget}
          onSetBaseline={onSetBaseline}
        />
      )}
    </div>
  )
}

/**
 * Modal "Ajustar reserva": correção do saldo (opcional) + meta de meses.
 * Só dispara a RPC do campo que mudou — evita dois reloads quando um só mexeu.
 */
function ReserveDialog({ reserve, balance, onClose, onSetTarget, onSetBaseline }) {
  const currentTarget = reserve?.targetMonths ?? null
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [months, setMonths] = useState(currentTarget == null ? '' : String(currentTarget))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    const wantsBaseline = amount.trim() !== ''
    const parsedAmount = wantsBaseline ? parseAmount(amount) : null
    if (wantsBaseline && (parsedAmount == null || parsedAmount < 0)) {
      setError('Informe um valor de saldo válido.')
      return
    }
    const normalizedMonths = months.trim() === '' ? null : Number(months)
    if (normalizedMonths != null && (!Number.isInteger(normalizedMonths) || normalizedMonths < 1 || normalizedMonths > 60)) {
      setError('A meta deve ser um número de meses entre 1 e 60.')
      return
    }
    const targetChanged = normalizedMonths !== currentTarget

    setSaving(true)
    let ok = true
    if (wantsBaseline) ok = await onSetBaseline(parsedAmount, date)
    if (ok && targetChanged) ok = await onSetTarget(normalizedMonths)
    setSaving(false)
    if (ok) onClose()
    else setError('Não foi possível salvar. Tente novamente.')
  }

  return (
    <dialog open className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }} aria-label="Ajustar reserva de emergência">
      <div className="modal">
        <form onSubmit={handleSubmit}>
          <div className="modal-head">
            <div>
              <div className="card-title">Ajustar reserva</div>
              <div className="card-sub">Corrija o saldo real e defina sua meta de meses</div>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className="modal-body stack" style={{ gap: 16 }}>
            <div className="field">
              <label className="label" htmlFor="reserve-amount">Saldo atual da reserva</label>
              <input
                id="reserve-amount" className="input" inputMode="decimal"
                value={amount} onChange={(event) => setAmount(event.target.value)}
                placeholder={formatCurrency(balance)}
              />
              <span className="hint">Deixe em branco para não corrigir agora. O saldo cresce sozinho com lançamentos na categoria “Reserva de emergência”.</span>
            </div>

            <div className="field">
              <label className="label" htmlFor="reserve-date">Data da correção</label>
              <input
                id="reserve-date" className="input" type="date"
                value={date} max={todayISO()} onChange={(event) => setDate(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="reserve-months">Meta de meses</label>
              <input
                id="reserve-months" className="input" type="number" min="1" max="60" step="1"
                value={months} onChange={(event) => setMonths(event.target.value)}
                placeholder="ex.: 6"
              />
              <span className="hint">Quantos meses de despesa você quer cobrir. Deixe em branco para não usar meta.</span>
            </div>

            {error && <p className="field-error" role="alert">{error}</p>}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
      </div>
    </dialog>
  )
}
