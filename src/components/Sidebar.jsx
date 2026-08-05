import { Wallet } from 'lucide-react'
import { NAV_GROUPS, NAV_ITEMS } from './navigation.js'

/**
 * Navegacao lateral fixa do desktop.
 *
 * Substitui o antigo menu horizontal de abas. Recebe e devolve exatamente
 * os mesmos valores que o componente de abas anterior (`active`, `onChange`,
 * `badges`), entao a troca de painel em App.jsx continua igual.
 */
export default function Sidebar({ active, onChange, badges = {} }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo">
          <Wallet size={18} strokeWidth={2} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="brand-title">Planejador</div>
          <div className="brand-sub">Finanças sob controle</div>
        </div>
      </div>

      {NAV_GROUPS.map((group) => {
        const items = NAV_ITEMS.filter((item) => item.group === group.id)
        if (items.length === 0) return null

        return (
          <div key={group.id}>
            <div className="sidebar-section">{group.label}</div>
            <nav className="sidebar-nav" role="tablist" aria-label={group.label}>
              {items.map((item) => {
                const Icon = item.icon
                const isActive = active === item.id
                const badge = badges[item.id]

                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`sidebar-link${isActive ? ' active' : ''}`}
                    onClick={() => onChange(item.id)}
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
