import { addMonths, currentMonthKey, monthLabel } from '../utils/format.js'

export default function Header({ monthKey, onMonthChange, theme, onToggleTheme, user, onSignOut }) {
  const isCurrent = monthKey === currentMonthKey()

  return (
    <header className="header">
      <div className="container header-inner">
        <div className="brand">
          <div className="brand-logo">💰</div>
          <div>
            <div className="brand-title">Planejador Financeiro</div>
            <div className="brand-sub">Suas finanças sob controle</div>
          </div>
        </div>

        <div className="row">
          <div className="month-nav">
            <button
              type="button"
              onClick={() => onMonthChange(addMonths(monthKey, -1))}
              title="Mês anterior"
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <div className="month-nav-label">{monthLabel(monthKey)}</div>
            <button
              type="button"
              onClick={() => onMonthChange(addMonths(monthKey, 1))}
              title="Próximo mês"
              aria-label="Próximo mês"
            >
              ›
            </button>
            {!isCurrent && (
              <button
                type="button"
                className="month-nav-today"
                onClick={() => onMonthChange(currentMonthKey())}
                title="Voltar para o mês atual"
              >
                HOJE
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-icon"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            aria-label="Alternar tema"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <div className="user-menu">
            <span className="user-email" title={user?.email}>{user?.email}</span>
            <button type="button" className="btn btn-sm" onClick={onSignOut}>Sair</button>
          </div>
        </div>
      </div>
    </header>
  )
}
