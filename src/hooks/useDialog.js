import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Focaveis dentro do dialogo, na ordem do DOM. `[tabindex="-1"]` fica de fora
 * de proposito: e justamente o marcador de "alcancavel por script, nao por Tab".
 */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** modal-surface-leave e modal-backdrop-leave duram 220ms em styles.css; 240 da folga. */
const LEAVE_MS = 240

/**
 * Teclado e foco de um dialogo modal.
 *
 * Devolve `closing` (alimenta a classe `is-closing`), `close` (fechamento
 * animado, usado por TODOS os caminhos - Esc, X, backdrop e submit, para que o
 * metodo de fechamento nao decida se anima) e `surfaceRef`, que o chamador
 * pendura na caixa do dialogo.
 *
 * `active` cobre os dois regimes do projeto: os modais de GoalsPanel.jsx montam
 * e desmontam, e o de TransactionForm.jsx fica montado o tempo todo por causa do
 * `if (!open) return null` no topo, alternando so a prop `open`.
 *
 * `locked` recusa o fechamento sem desmontar nada - e para o `saving` do
 * EditContributionModal, que nao pode fechar no meio de uma gravacao. Fica no
 * hook, e nao num guard do chamador, porque o Esc dispara o `close` daqui e
 * escaparia de qualquer guard que existisse so nos onClick.
 *
 * DUAS ARMADILHAS, e e por elas que o codigo nao e mais curto:
 *
 *   1. O guard do fechamento e um ref, nao o proprio state. O cleanup do efeito
 *      devolve o foco a quem abriu; se `close` mudasse de identidade a cada
 *      render, entraria nas deps do efeito e o foco voltaria em todo render.
 *      `useCallback` com deps vazias resolve isso, e ai o guard nao pode ler
 *      state - so um ref sobrevive entre renders sem virar dependencia.
 *
 *   2. O keydown vive na caixa, nao no document. "Mais detalhes" e "Editar
 *      aporte" ficam montados ao mesmo tempo - o botao que abre o segundo esta
 *      dentro do primeiro. Dois listeners no document fariam um unico Esc fechar
 *      os dois; na caixa, so o dialogo que tem o foco recebe a tecla, e a
 *      armadilha de Tab abaixo garante que o foco esta dentro.
 */
export function useDialog(onClose, active = true, locked = false) {
  const [closing, setClosing] = useState(false)
  const surfaceRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const closingRef = useRef(false)
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  const openerRef = useRef(null)

  // Quem abriu o dialogo, lido no render e nao no efeito: o `autoFocus` do
  // EditContributionModal e do TransactionForm ja levou o foco para dentro da caixa
  // quando o efeito passivo roda, e o cleanup devolveria o foco a um elemento que
  // esta sendo desmontado - ou seja, nao devolveria nada. No render em que `active`
  // vira true a caixa ainda nao existe no DOM, entao aqui o foco ainda esta no botao.
  if (!active) openerRef.current = null
  else if (!openerRef.current) openerRef.current = document.activeElement

  const close = useCallback(() => {
    if (closingRef.current || lockedRef.current) return
    closingRef.current = true
    setClosing(true)
    // Sem ref nem limpeza do timer, de proposito: quem recebe o callback e o
    // `onClose` do pai, que continua montado, e reabrir dentro dos 240 ms nao
    // alcanca o timer velho porque o backdrop segue cobrindo a tela - nem
    // `.modal-backdrop.is-closing` nem `.reverse-modal-backdrop.is-closing`
    // desligam `pointer-events`.
    window.setTimeout(() => onCloseRef.current(), LEAVE_MS)
  }, [])

  useEffect(() => {
    if (!active) return undefined
    closingRef.current = false
    setClosing(false)
    // Copiado para local porque o cleanup roda depois do render que zera o ref.
    const opener = openerRef.current
    const surface = surfaceRef.current
    if (!surface) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        close()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...surface.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (document.activeElement !== (event.shiftKey ? first : last)) return
      const target = event.shiftKey ? last : first
      event.preventDefault()
      target.focus()
    }

    surface.addEventListener('keydown', onKeyDown)
    return () => {
      surface.removeEventListener('keydown', onKeyDown)
      // Devolve o foco a quem abriu. Sem isto o foco cai no <body> e quem navega
      // por teclado recomeca do topo da pagina.
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [active, close])

  return { closing, close, surfaceRef }
}
