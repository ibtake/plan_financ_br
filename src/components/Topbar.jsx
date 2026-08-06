import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Moon,
  Search,
  Sun,
  Wallet,
  X,
} from 'lucide-react'
import { addMonths, currentMonthKey, formatCurrency, formatDate, monthLabel, todayISO } from '../utils/format.js'

/** Fecha o popover ao clicar fora ou apertar Esc */
function useDismiss(ref, onDismiss, active) {
  useEffect(() => {
    if (!active) return
    const onPointer = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onDismiss()
    }
    const onKey = (event) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, onDismiss, active])
}

/** Iniciais para o avatar do perfil */
function initials(email) {
  if (!email) return '?'
  return email.trim().slice(0, 2)
}

/**
 * Barra superior.
 *
 * Concentra apenas período, pesquisa, notificações e perfil — a navegação
 * entre painéis fica na sidebar (desktop) ou na barra inferior (mobile).
 *
 * Notificações e pesquisa apenas reorganizam dados que já existiam:
 * `pending` vem das ocorrências não pagas do mês e `onSearch` reaproveita
 * o filtro de busca da lista de lançamentos.
 */
export default function Topbar({
  monthKey,
  onMonthChange,
  theme,
  onToggleTheme,
  user,
  onSignOut,
  search,
  onSearch,
  pending = [],
  pendingTotal = 0,
  onOpenPending,
}) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const profileRef = useRef(null)
  const bellRef = useRef(null)
  const searchRef = useRef(null)

  useDismiss(profileRef, () => setProfileOpen(false), profileOpen)
  useDismiss(bellRef, () => setBellOpen(false), bellOpen)

  const isCurrent = monthKey === currentMonthKey()
  const count = pending.length
  const orderedPending = [...pending].sort((a, b) => a.date.localeCompare(b.date))

  // Ao abrir a busca no mobile, foca o campo
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  const goToPending = (occurrence) => {
    setBellOpen(false)
    onOpenPending?.(occurrence)
  }

  return (
    <header className="topbar">
      <div className="topbar-mobile-brand">
        <div className="brand-logo" style={{ width: 30, height: 30 }}>
          <Wallet size={16} strokeWidth={2} />
        </div>
      </div>

      {/* Período */}
      <div className="month-nav">
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(monthKey, -1))}
          title="Mês anterior"
          aria-label="Mês anterior"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <div className="month-nav-label">{monthLabel(monthKey)}</div>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(monthKey, 1))}
          title="Próximo mês"
          aria-label="Próximo mês"
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>
        {!isCurrent && (
          <button
            type="button"
            className="month-nav-today"
            onClick={() => onMonthChange(currentMonthKey())}
            title="Voltar para o mês atual"
          >
            Hoje
          </button>
        )}
      </div>

      <div className="topbar-spacer" />

      {/* Pesquisa */}
      <div className={`topbar-search${searchOpen ? ' open' : ''}`}>
        <Search size={15} strokeWidth={2} />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Buscar lançamentos..."
          aria-label="Buscar lançamentos"
        />
      </div>

      <div className="topbar-actions">
        {/* Abre o campo de busca no mobile */}
        <button
          type="button"
          className={`topbar-btn topbar-search-toggle${searchOpen ? ' active' : ''}`}
          onClick={() => setSearchOpen((open) => !open)}
          title="Buscar"
          aria-label="Buscar"
          aria-expanded={searchOpen}
        >
          {searchOpen ? <X size={18} strokeWidth={1.9} /> : <Search size={18} strokeWidth={1.9} />}
        </button>

        {/* Notificações */}
        <div className="popover-anchor" ref={bellRef}>
          <button
            type="button"
            className={`topbar-btn${bellOpen ? ' active' : ''}`}
            onClick={() => setBellOpen((open) => !open)}
            title="Notificações"
            aria-label={`Notificações${count > 0 ? ` (${count} pendentes)` : ''}`}
            aria-expanded={bellOpen}
          >
            <Bell size={18} strokeWidth={1.9} />
            {count > 0 && <span className="topbar-dot">{count > 9 ? '9+' : count}</span>}
          </button>

          {bellOpen && (
            <div className="popover" role="dialog" aria-label="Notificações">
              <div className="popover-head">
                <div className="popover-title">Pendências do mês</div>
                <div className="popover-sub">
                  {count > 0
                    ? `${count} ${count === 1 ? 'lançamento' : 'lançamentos'} • ${formatCurrency(pendingTotal)}`
                    : 'Nada pendente por aqui'}
                </div>
              </div>

              {count === 0 ? (
                <div className="popover-empty">Todos os lançamentos deste mês estão quitados.</div>
              ) : (
                orderedPending.slice(0, 6).map((item) => {
                  const isDueToday = item.date === todayISO()
                  return (
                  <button
                    key={item.id}
                    type="button"
                    className={`popover-item${isDueToday ? ' due-today' : ''}`}
                    onClick={() => goToPending(item)}
                  >
                    <span className="grow" style={{ display: 'grid' }}>
                      <span className="tx-desc">{item.description}</span>
                      <span className={`text-xs${isDueToday ? ' text-expense fw-600' : ' text-muted'}`}>
                        {isDueToday ? 'VENCE HOJE' : `vence ${formatDate(item.date)}`}
                      </span>
                    </span>
                    <span
                      className={`mono fw-600 ${item.type === 'income' ? 'text-income' : 'text-expense'}`}
                    >
                      {formatCurrency(item.amount)}
                    </span>
                  </button>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Tema */}
        <button
          type="button"
          className="topbar-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          aria-label="Alternar tema"
        >
          {theme === 'dark' ? <Sun size={18} strokeWidth={1.9} /> : <Moon size={18} strokeWidth={1.9} />}
        </button>

        {/* Perfil */}
        <div className="popover-anchor" ref={profileRef}>
          <button
            type="button"
            className={`topbar-btn${profileOpen ? ' active' : ''}`}
            onClick={() => setProfileOpen((open) => !open)}
            title={user?.email}
            aria-label="Menu da conta"
            aria-expanded={profileOpen}
            style={{ width: 34 }}
          >
            <span className="avatar">{initials(user?.email)}</span>
          </button>

          {profileOpen && (
            <div className="popover" role="menu" aria-label="Conta">
              <div className="popover-head">
                <div className="popover-title">Conta</div>
                <div className="popover-sub" title={user?.email}>{user?.email}</div>
              </div>
              <button type="button" className="popover-item danger" onClick={onSignOut} role="menuitem">
                <LogOut size={16} strokeWidth={1.9} />
                Sair da conta
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
