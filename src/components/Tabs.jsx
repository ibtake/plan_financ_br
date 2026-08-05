import AppIcon from './AppIcon.jsx'

export const TABS = [
  { id: 'overview', label: 'Visão geral', icon: '📊' },
  { id: 'transactions', label: 'Lançamentos', icon: '📝' },
  { id: 'budget', label: 'Orçamento', icon: '🎯' },
  { id: 'goals', label: 'Metas', icon: '🏆' },
  { id: 'categories', label: 'Categorias', icon: '🏷️' },
  { id: 'icons', label: 'Ícones', icon: '🎨' },
  { id: 'security', label: 'Segurança', icon: '🔐' },
  { id: 'settings', label: 'Configurações', icon: '⚙️' },
]

export default function Tabs({ active, onChange, badges = {} }) {
  return (
    <nav className="tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`tab${active === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <AppIcon emoji={tab.icon} />
          {tab.label}
          {badges[tab.id] > 0 && <span className="tab-badge">{badges[tab.id]}</span>}
        </button>
      ))}
    </nav>
  )
}
