import { useEffect } from 'react'

/**
 * Altura do teclado virtual exposta como `--kb-inset` no `:root` (BUG-007).
 *
 * No Android, `interactive-widget=resizes-content` (index.html) encolhe o
 * layout com o teclado e a folha sobe sozinha - o overlap medido aqui fica
 * ~0 e a variavel nao tem efeito. O iOS Safari ignora esse parametro: o
 * teclado cobre o rodape do layout viewport, e e o padding-bottom de
 * `.reverse-modal-backdrop:has(.aporte-modal)` (styles.css, media 768px)
 * que empurra a folha de aporte para cima da area visivel.
 *
 * O overlap e `innerHeight - visualViewport.height - offsetTop`: o teclado
 * cobre exatamente o trecho do layout viewport abaixo do visual viewport.
 * `offsetTop` entra porque o iOS pan-e a pagina quando o foco ja esta
 * visivel, e sem ele o padding dobraria a compensacao.
 *
 * Escrita direta no `style` do `:root`, sem state: resize/scroll do
 * visualViewport disparam em rajada durante a animacao do teclado, e um
 * re-render por frame dos modais de aporte seria custo de graca.
 */
export function useKeyboardInset(active = true) {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!active || !viewport) return undefined
    const update = () => {
      const overlap = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
      document.documentElement.style.setProperty('--kb-inset', `${overlap}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      document.documentElement.style.removeProperty('--kb-inset')
    }
  }, [active])
}
