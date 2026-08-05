import { useState } from 'react'
import { MoreHorizontal, Plus, X } from 'lucide-react'
import { MOBILE_PRIMARY, MOBILE_SECONDARY } from './navigation.js'

/**
 * Navegacao inferior fixa do mobile.
 *
 * Mostra os 4 itens principais + menu "Mais" que abre um sheet com os
 * itens restantes. Recebe e devolve `active`, `onChange` e `badges` iguais
 * ao componente de abas anterior.
 */
export default function BottomNav({ active, onChange, badges = {}, onOpenNew }) {
  const [moreOpen, setMoreOpen] = useState(false)

  const handleSelect = (id) => {
    onChange(id)
    setMoreOpen(false)
  }

  return (
    <>
      <nav className="bottom-nav">
        <div className="bottom-nav-list">
          {MOBILE_PRIMARY.map((item) => {
            const Icon = item.icon
            const isActive = active === item.id
            const badge = badges[item.id]

            return (
              <button
                key={item.id}
                type="button"
                className={`bottom-nav-link${isActive ? ' active' : ''}`}
                onClick={() => onChange(item.id)}
              >
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{item.short || item.label}</span>
                {badge > 0 && <span className="bottom-nav-badge">{badge}</span>}
              </button>
            )
          })}

          <button
            type="button"
            className="bottom-nav-link"
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontal size={20} strokeWidth={1.8} />
            <span>Mais</span>
          </button>
        </div>
      </nav>

      {/* FAB: botão de "Novo lançamento" fixo */}
      {onOpenNew && (
        <button
          type="button"
          className="fab"
          onClick={onOpenNew}
          aria-label="Novo lançamento"
        >
          <Plus size={24} strokeWidth={2.2} />
        </button>
      )}

      {/* Sheet com os itens secundários */}
      {moreOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div style={{ padding: '8px 0 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 12px' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Mais opções</h3>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setMoreOpen(false)}
                  aria-label="Fechar"
                >
                  <X size={18} strokeWidth={2} />
                </button>
              </div>
              <nav>
                {MOBILE_SECONDARY.map((item) => {
                  const Icon = item.icon
                  const isActive = active === item.id
                  const badge = badges[item.id]

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`sidebar-link${isActive ? ' active' : ''}`}
                      onClick={() => handleSelect(item.id)}
                    >
                      <Icon size={18} strokeWidth={1.9} />
                      <span className="sidebar-link-label">{item.label}</span>
                      {badge > 0 && <span className="sidebar-badge">{badge}</span>}
                    </button>
                  )
                })}
              </nav>
            </div>
          </div>
        </>
      )}
    </>
  )
}
