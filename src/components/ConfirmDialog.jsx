import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { useDialog } from '../hooks/useDialog.js'

/**
 * Diálogo de confirmação reutilizável (IMPR-015) — substitui window.confirm nos
 * fluxos destrutivos. Controlado por estado (não por Promise): cada tela guarda
 * o que está sendo confirmado e passa `onConfirm`. Construído sobre useDialog,
 * então herda focus-trap, Escape e devolução de foco iguais aos demais modais.
 *
 * Renderiza só quando `open`; segue o padrão do ReserveDialog/TransactionForm
 * (.modal-backdrop > .modal, animação is-closing pelo `closing` do hook).
 */
export default function ConfirmDialog({
  open,
  title = 'Confirmar',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onClose,
}) {
  const { closing, close, surfaceRef } = useDialog(onClose, open)

  if (!open) return null

  const handleConfirm = () => {
    if (closing) return
    onConfirm?.()
    close()
  }

  return (
    <dialog
      open
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className={`modal-backdrop${closing ? ' is-closing' : ''}`}
      onClick={(event) => { if (event.target === event.currentTarget) close() }}
    >
      <div ref={surfaceRef} className={`modal modal-sm${closing ? ' is-closing' : ''}`}>
        <div className="modal-head">
          <div className="card-title">{title}</div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Fechar">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>{cancelLabel}</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={handleConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}

/**
 * Açúcar sobre ConfirmDialog: substitui `if (window.confirm(msg)) act()` sem a
 * tela ter de declarar estado nem soltar o componente no JSX à mão. Devolve
 * `[confirm, dialog]` — chame `confirm({ message, onConfirm, ... })` no handler
 * e renderize `{dialog}` uma vez no componente. `onConfirm` só roda no botão de
 * confirmar; fechar/cancelar/Escape descartam.
 */
export function useConfirm() {
  const [state, setState] = useState(null)

  const confirm = useCallback((options) => setState(options), [])
  const close = useCallback(() => setState(null), [])

  const dialog = (
    <ConfirmDialog
      open={state != null}
      title={state?.title}
      message={state?.message}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      danger={state?.danger}
      onConfirm={() => state?.onConfirm?.()}
      onClose={close}
    />
  )

  return [confirm, dialog]
}
