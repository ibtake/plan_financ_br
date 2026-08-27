import { useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Play, Repeat2, X } from 'lucide-react'
import {
  PAYMENT_METHODS,
  RECURRENCE_OPTIONS,
  categoriesByType,
} from '../utils/categories.js'
import { amountToInput, formatAmountInput, parseAmount, todayISO } from '../utils/format.js'
import { RECURRENCE_END_ERROR, recurrenceEndBeforeStart } from '../utils/recurrence.js'
import { normalizeTransactionFormFields } from '../utils/transactionFormFields.js'
import { useDialog } from '../hooks/useDialog.js'
import { parseQuickTransaction } from '../utils/quickTransaction.js'

const EMPTY = {
  type: 'expense',
  description: '',
  amount: '',
  categoryId: '',
  date: todayISO(),
  method: 'pix',
  paid: false,
  recurrence: 'none',
  recurrenceEnd: '',
  installments: 1,
  tags: '',
  note: '',
}

export default function TransactionForm({ open, onClose, onSubmit, initial, categories, transactions, defaultDate, fieldVisibility }) {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [quickText, setQuickText] = useState('')
  const isEditing = Boolean(initial?.id)
  const visibleFields = normalizeTransactionFormFields(fieldVisibility)
  const { closing, close, surfaceRef } = useDialog(onClose, open)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setForm({
        ...EMPTY,
        ...initial,
        amount: amountToInput(initial.amount),
        tags: Array.isArray(initial.tags) ? initial.tags.join(', ') : initial.tags || '',
      })
    } else {
      setForm({ ...EMPTY, date: defaultDate || todayISO() })
    }
    setErrors({})
    setQuickText('')
  }, [open, initial, defaultDate])

  const available = useMemo(
    () => categoriesByType(categories, form.type),
    [categories, form.type],
  )

  // Garante que a categoria pertence ao tipo escolhido
  useEffect(() => {
    if (!open) return
    if (!available.some((c) => c.id === form.categoryId)) {
      setForm((f) => ({ ...f, categoryId: available[0]?.id || '' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, open])

  if (!open) return null

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const showField = (field) => isEditing || visibleFields[field]

  const executeQuickEntry = () => {
    const parsed = parseQuickTransaction(quickText, { defaultDate, categories, transactions: transactions || [] })
    if (!parsed) return
    setForm((current) => ({ ...current, ...parsed, amount: parsed.amount ? amountToInput(parsed.amount) : current.amount }))
    setQuickText('')
  }

  const validate = () => {
    const e = {}
    if (!form.description.trim()) e.description = 'Informe uma descrição.'
    if (parseAmount(form.amount) <= 0) e.amount = 'Informe um valor maior que zero.'
    if (!form.date) e.date = 'Informe a data.'
    if (!form.categoryId) e.categoryId = 'Escolha uma categoria.'
    // Fim de repeticao anterior ao lancamento barra o salvamento, por decisao do
    // usuario em 24/08/2026. O `min={form.date}` do campo (`:334`) ja e a barreira
    // nativa, mas a mensagem dele e do navegador e generica; esta aqui diz o motivo
    // em portugues. Condicionado a `recurrence !== 'none'` porque o campo some com
    // repeticao nenhuma e um erro em campo invisivel travaria o formulario sem
    // explicacao - o valor velho sobrevive no state quando se volta para 'none'.
    // A comparacao mora em recurrence.js para o import aplicar a mesma regra.
    if (form.recurrence !== 'none' && recurrenceEndBeforeStart(form)) {
      e.recurrenceEnd = RECURRENCE_END_ERROR
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    // Guarda de duplo-clique: durante os ~240ms de animacao de fechamento o
    // botao segue clicavel; sem isso, dois cliques geram duas transacoes.
    if (closing) return
    if (!validate()) return
    onSubmit({
      ...form,
      amount: parseAmount(form.amount),
      installments: Math.max(1, Number(form.installments) || 1),
    })
    close()
  }

  const installments = Math.max(1, Number(form.installments) || 1)
  const amountValue = parseAmount(form.amount)

  return (
    <dialog open className={`modal-backdrop${closing ? ' is-closing' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) close() }} aria-label={isEditing ? 'Editar lançamento' : 'Novo lançamento'}>
      <div
        ref={surfaceRef}
        className={`modal${closing ? ' is-closing' : ''}`}
      >
        <form onSubmit={handleSubmit}>
          <div className="modal-head transaction-form-head">
            <div>
              <div className="card-title">
                {isEditing ? 'Editar lançamento' : 'Novo lançamento'}
              </div>
              {isEditing && <div className="card-sub">Altere os dados e salve</div>}
            </div>
            <button type="button" className="icon-btn" onClick={close} aria-label="Fechar">
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className="modal-body stack transaction-form-body" style={{ gap: 16 }}>
            {!isEditing && <div className="field quick-entry-field">
              <label className="label" htmlFor="tx-quick-entry">Lançamento rápido</label>
              <div className="quick-entry-row">
                <input
                  id="tx-quick-entry"
                  className="input"
                  value={quickText}
                  onChange={(event) => setQuickText(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); executeQuickEntry() } }}
                  placeholder={'Diga: "Luz 66,30 dia 10"'}
                  autoFocus
                />
                <button type="button" className="btn btn-primary btn-icon" onClick={executeQuickEntry} disabled={!quickText.trim()} title="Executar lançamento rápido" aria-label="Executar lançamento rápido">
                  <Play size={16} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
              {errors.quick && <span className="field-error">{errors.quick}</span>}
            </div>}

            <div className="type-toggle">
              <button
                type="button"
                className={form.type === 'expense' ? 'active-expense' : ''}
                onClick={() => set({ type: 'expense' })}
              >
                <ArrowUpRight size={16} strokeWidth={2} />
                <span>Despesa</span>
              </button>
              <button
                type="button"
                className={form.type === 'reinvested' ? 'active-reinvested' : ''}
                onClick={() => set({ type: 'reinvested' })}
                title="Saída de caixa que vira patrimônio (reinvestimento)"
              >
                <Repeat2 size={16} strokeWidth={2} />
                <span>Reinvestido</span>
              </button>
              <button
                type="button"
                className={form.type === 'income' ? 'active-income' : ''}
                onClick={() => set({ type: 'income' })}
              >
                <ArrowDownLeft size={16} strokeWidth={2} />
                <span>Receita</span>
              </button>
            </div>

            {form.type === 'reinvested' && (
              <div className="hint">
                Sai da liquidez do mês como qualquer saída, mas soma no patrimônio
                acumulado e na taxa de poupança em vez de contar como consumo.
              </div>
            )}

            <div className="form-grid">
              <div className="field span-2">
                <label className="label" htmlFor="tx-desc">
                  Descrição *
                </label>
                <input
                  id="tx-desc"
                  className={`input${errors.description ? ' input-invalid' : ''}`}
                  aria-invalid={Boolean(errors.description)}
                  aria-describedby={errors.description ? 'tx-desc-error' : undefined}
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  maxLength={200}
                  placeholder="Ex.: Supermercado, Salário, Aluguel..."
                />
                {errors.description && <span id="tx-desc-error" className="field-error">{errors.description}</span>}
              </div>

              <div className="field">
                <label className="label" htmlFor="tx-amount">
                  Valor (R$) *
                </label>
                <input
                  id="tx-amount"
                  className={`input mono${errors.amount ? ' input-invalid' : ''}`}
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby={errors.amount ? 'tx-amount-error' : undefined}
                  value={form.amount}
                  onChange={(e) => set({ amount: formatAmountInput(e.target.value) })}
                  placeholder="0,00"
                  inputMode="numeric"
                />
                {errors.amount && <span id="tx-amount-error" className="field-error">{errors.amount}</span>}
              </div>

              <div className="field">
                <label className="label" htmlFor="tx-date">
                  Data *
                </label>
                <input
                  id="tx-date"
                  type="date"
                  className={`input${errors.date ? ' input-invalid' : ''}`}
                  aria-invalid={Boolean(errors.date)}
                  aria-describedby={errors.date ? 'tx-date-error' : undefined}
                  value={form.date}
                  onChange={(e) => set({ date: e.target.value })}
                />
                {errors.date && <span id="tx-date-error" className="field-error">{errors.date}</span>}
              </div>

              <div className="field">
                <label className="label" htmlFor="tx-cat">
                  Categoria *
                </label>
                <select
                  id="tx-cat"
                  className={`select${errors.categoryId ? ' input-invalid' : ''}`}
                  aria-invalid={Boolean(errors.categoryId)}
                  aria-describedby={errors.categoryId ? 'tx-cat-error' : undefined}
                  value={form.categoryId}
                  onChange={(e) => set({ categoryId: e.target.value })}
                >
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
                {errors.categoryId && <span id="tx-cat-error" className="field-error">{errors.categoryId}</span>}
              </div>

              {showField('method') && <div className="field">
                <label className="label" htmlFor="tx-method">
                  Forma de pagamento
                </label>
                <select
                  id="tx-method"
                  className="select"
                  value={form.method}
                  onChange={(e) => set({ method: e.target.value })}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.icon} {m.name}
                    </option>
                  ))}
                </select>
              </div>}

              {showField('recurrence') && <div className="field">
                <label className="label" htmlFor="tx-rec">
                  Repetição
                </label>
                <select
                  id="tx-rec"
                  className="select"
                  value={form.recurrence}
                  onChange={(e) =>
                    set({ recurrence: e.target.value, installments: 1 })
                  }
                  disabled={installments > 1}
                >
                  {RECURRENCE_OPTIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>}

              {showField('installments') && <div className="field">
                <label className="label" htmlFor="tx-inst">
                  Parcelas
                </label>
                <input
                  id="tx-inst"
                  type="number"
                  min="1"
                  max="120"
                  className="input mono"
                  value={form.installments}
                  onChange={(e) =>
                    set({
                      installments: e.target.value,
                      recurrence: Number(e.target.value) > 1 ? 'none' : form.recurrence,
                    })
                  }
                  disabled={form.recurrence !== 'none'}
                />
                <span className="hint">
                  {installments > 1
                    ? `${installments}x de R$ ${(amountValue).toFixed(2).replace('.', ',')} (por mês)`
                    : 'Deixe 1 para pagamento único'}
                </span>
              </div>}

              {showField('recurrence') && form.recurrence !== 'none' && (
                <div className="field span-2">
                  <label className="label" htmlFor="tx-rec-end">
                    Repetir até (opcional)
                  </label>
                  <input
                    id="tx-rec-end"
                    type="date"
                    className={`input${errors.recurrenceEnd ? ' input-invalid' : ''}`}
                    aria-invalid={Boolean(errors.recurrenceEnd)}
                    aria-describedby={errors.recurrenceEnd ? 'tx-rec-end-error' : undefined}
                    value={form.recurrenceEnd}
                    onChange={(e) => set({ recurrenceEnd: e.target.value })}
                    min={form.date}
                  />
                  {errors.recurrenceEnd && <span id="tx-rec-end-error" className="field-error">{errors.recurrenceEnd}</span>}
                  <span className="hint">Em branco = repete indefinidamente.</span>
                </div>
              )}

              {showField('tags') && <div className="field span-2">
                <label className="label" htmlFor="tx-tags">
                  Tags (opcional)
                </label>
                <input
                  id="tx-tags"
                  className="input"
                  value={form.tags}
                  onChange={(e) => set({ tags: e.target.value })}
                  placeholder="Ex.: viagem, trabalho, urgente"
                />
              </div>}

              {showField('note') && <div className="field span-2">
                <label className="label" htmlFor="tx-note">
                  Observação (opcional)
                </label>
                <textarea
                  id="tx-note"
                  className="textarea"
                  value={form.note}
                  onChange={(e) => set({ note: e.target.value })}
                  maxLength={1000}
                  placeholder="Anotações extras sobre este lançamento..."
                />
              </div>}

              {showField('paid') && <label className="checkbox span-2">
                <input
                  type="checkbox"
                  checked={form.paid !== false}
                  onChange={(e) => set({ paid: e.target.checked })}
                />
                <span>
                  {form.type === 'income' ? 'Já recebido' : 'Já pago'}
                  <span className="hint">
                    {' '}
                    — desmarque para tratar como {form.type === 'income' ? 'a receber' : 'conta a pagar'}
                  </span>
                </span>
              </label>}
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn" onClick={close}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={closing}>
              {isEditing ? 'Salvar alterações' : 'Adicionar lançamento'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}
