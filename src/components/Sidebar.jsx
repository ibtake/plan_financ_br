import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { NAV_GROUPS, NAV_ITEMS } from './navigation.js'

/**
 * Navegacao lateral fixa do desktop.
 *
 * Substitui o antigo menu horizontal de abas. Recebe e devolve exatamente
 * os mesmos valores que o componente de abas anterior (`active`, `onChange`,
 * `badges`), entao a troca de painel em App.jsx continua igual.
 */
export default function Sidebar({ active, onChange, badges = {} }) {
  const sidebarRef = useRef(null)
  const itemRefs = useRef(new Map())
  const [hovered, setHovered] = useState(null)
  const [indicator, setIndicator] = useState({ top: 0, left: 0, width: 0, height: 0 })
  const targetId = hovered || active

  const moveIndicator = useCallback((id) => {
    const sidebar = sidebarRef.current
    const item = itemRefs.current.get(id)
    if (!sidebar || !item) return
    const sidebarRect = sidebar.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    setIndicator({
      top: itemRect.top - sidebarRect.top + sidebar.scrollTop,
      left: itemRect.left - sidebarRect.left,
      width: itemRect.width,
      height: itemRect.height,
    })
  }, [])

  useLayoutEffect(() => {
    moveIndicator(targetId)
  }, [moveIndicator, targetId])

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) return undefined
    const refresh = () => moveIndicator(targetId)
    sidebar.addEventListener('scroll', refresh, { passive: true })
    window.addEventListener('resize', refresh)
    const observer = new ResizeObserver(refresh)
    observer.observe(sidebar)
    return () => {
      sidebar.removeEventListener('scroll', refresh)
      window.removeEventListener('resize', refresh)
      observer.disconnect()
    }
  }, [moveIndicator, targetId])

  return (
    <aside className="sidebar" ref={sidebarRef} onMouseLeave={() => setHovered(null)}>
      <span
        className="sidebar-hover-pill"
        aria-hidden="true"
        style={{ '--sidebar-pill-y': `${indicator.top}px`, left: indicator.left, width: indicator.width, height: indicator.height }}
      />
      <div className="sidebar-brand">
        <div className="brand-logo">
          <img className="brand-favicon" src="/dindin-10-logo.png" alt="DinDin 10!" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="brand-title">DinDin 10!</div>
          <div className="brand-sub">Finanças sob controle</div>
        </div>
      </div>

      {NAV_GROUPS.map((group) => {
        const items = NAV_ITEMS.filter((item) => item.group === group.id)
        if (items.length === 0) return null

        return (
          <div key={group.id}>
            <div className="sidebar-section">{group.label}</div>
            <nav className="sidebar-nav" aria-label={group.label}>
              {items.map((item) => {
                const Icon = item.icon
                const isActive = active === item.id
                const badge = badges[item.id]

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    className={`sidebar-link${isActive ? ' active' : ''}${hovered === item.id ? ' is-hovered' : ''}`}
                    onClick={() => onChange(item.id)}
                    onMouseEnter={() => setHovered(item.id)}
                    ref={(node) => {
                      if (node) itemRefs.current.set(item.id, node)
                      else itemRefs.current.delete(item.id)
                    }}
                  >
                    <Icon size={17} strokeWidth={1.9} />
                    <span className="sidebar-link-label">{item.label}</span>
                    {badge > 0 && <span className="sidebar-badge">{badge}</span>}
                  </button>
                )
              })}
            </nav>
          </div>
        )
      })}
    </aside>
  )
}
