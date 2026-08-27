import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { MOBILE_PRIMARY, MOBILE_SECONDARY } from './navigation.js'

/**
 * Navegacao inferior flutuante do mobile.
 *
 * Mostra os 4 itens principais + menu "Mais" que abre um popover com os
 * itens restantes. Recebe e devolve `active`, `onChange` e `badges` iguais
 * ao componente de abas anterior.
 */
export default function BottomNav({ active, onChange, badges = {}, onOpenNew }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const navRef = useRef(null)
  const moreButtonRef = useRef(null)
  const primaryIndex = MOBILE_PRIMARY.findIndex((item) => item.id === active)
  const moreIsActive = primaryIndex === -1
  const activeIndex = moreIsActive ? MOBILE_PRIMARY.length : primaryIndex

  useEffect(() => {
    if (!moreOpen) return undefined

    const closeOnOutsideInteraction = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) setMoreOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setMoreOpen(false)
        moreButtonRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideInteraction)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [moreOpen])

  const handleSelect = (id) => {
    onChange(id)
    setMoreOpen(false)
  }

  return (
    <div className="mobile-nav-dock">
      <nav
        ref={navRef}
        className="bottom-nav"
        style={{ '--active-index': activeIndex }}
        aria-label="Navegação principal"
      >
        <div className="bottom-nav-list">
          <span className="bottom-nav-active-pill" aria-hidden="true" />
          {MOBILE_PRIMARY.map((item) => {
            const Icon = item.icon
            const isActive = active === item.id
            const badge = badges[item.id]

            return (
              <button
                key={item.id}
                type="button"
                className={`bottom-nav-link${isActive ? ' active' : ''}`}
                onClick={() => handleSelect(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{item.short || item.label}</span>
                {badge > 0 && <span className="bottom-nav-badge">{badge}</span>}
              </button>
            )
          })}

          <button
            ref={moreButtonRef}
            type="button"
            className={`bottom-nav-link${moreIsActive || moreOpen ? ' active' : ''}`}
            onClick={() => setMoreOpen((isOpen) => !isOpen)}
            aria-current={moreIsActive ? 'page' : undefined}
            aria-expanded={moreOpen}
            aria-controls="bottom-nav-more-menu"
            aria-haspopup="menu"
          >
            <MoreHorizontal size={20} strokeWidth={moreIsActive || moreOpen ? 2.2 : 1.8} />
            <span>Mais</span>
          </button>
        </div>

        <div
          id="bottom-nav-more-menu"
          className={`bottom-nav-popover${moreOpen ? ' is-open' : ''}`}
          aria-hidden={!moreOpen}
        >
          <div className="bottom-nav-popover-title">Mais opções</div>
          <div className="bottom-nav-popover-list" role="menu" aria-label="Mais opções">
            {MOBILE_SECONDARY.map((item) => {
              const Icon = item.icon
              const isActive = active === item.id
              const badge = badges[item.id]

              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`bottom-nav-popover-item${isActive ? ' active' : ''}`}
                  onClick={() => handleSelect(item.id)}
                  tabIndex={moreOpen ? 0 : -1}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon size={18} strokeWidth={isActive ? 2.1 : 1.8} />
                  <span>{item.label}</span>
                  {badge > 0 && <span className="bottom-nav-popover-badge">{badge}</span>}
                </button>
              )
            })}
          </div>
        </div>
      </nav>

      {onOpenNew && (
        <button
          type="button"
          className={`fab${moreOpen ? ' is-hidden' : ''}`}
          onClick={onOpenNew}
          aria-label="Novo lançamento"
          aria-hidden={moreOpen}
          tabIndex={moreOpen ? -1 : 0}
        >
          <Plus size={24} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}
