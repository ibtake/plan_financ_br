import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  LogOut,
  Moon,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { addMonths, currentMonthKey, formatCurrency, formatDate, monthLabel, todayISO } from '../utils/format.js'

/** Fecha o popover ao clicar fora ou apertar Esc */
function useDismiss(ref, onDismiss, active) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!active) return
    const onPointer = (event) => {
      if (ref.current && !ref.current.contains(event.target)) dismissRef.current()
    }
    const onKey = (event) => {
      if (event.key === 'Escape') dismissRef.current()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, active])
}

/**
 * Navegacao de mes: os mesmos 29 nos apareciam duas vezes neste arquivo, em
 * `:138` (desktop) e `:305` (mobile, dentro de `.month-nav-scroll`), byte a byte
 * iguais - o `showMonthNav` envolvia as duas, uma colado no `month-nav` e outra
 * no wrapper de scroll, entao nem essa diferenca existia. Fica FORA de `Topbar`
 * de proposito: declarada dentro do corpo, a identidade da funcao mudaria a cada
 * render, o React trataria como outro tipo de componente e remontaria os botoes -
 * perdendo o foco de quem navega por teclado no meio da troca de mes (B39).
 */
function MonthNav({ monthKey, isMonthPending, isCurrent, onMonthChange }) {
  return (
    <div className="month-nav">
      <button
        type="button"
        onClick={() => onMonthChange((month) => addMonths(month, -1))}
        title="Mês anterior"
        aria-label="Mês anterior"
      >
        <ChevronLeft size={16} strokeWidth={2} />
      </button>
      <div className={`month-nav-label${isMonthPending ? ' is-updating' : ''}`}>{monthLabel(monthKey)}</div>
      <button
        type="button"
        onClick={() => onMonthChange((month) => addMonths(month, 1))}
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
  )
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
  isMonthPending = false,
  theme,
  onToggleTheme,
  privacyVisible,
  onTogglePrivacy,
  user,
  onSignOut,
  search,
  onSearch,
  pending = [],
  pendingTotal = 0,
  onOpenPending,
  showMonthNav = true,
}) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Rascunho local da busca: responde a cada tecla SEM re-renderizar a raiz
  // da arvore; o valor so propaga via onSearch apos a pausa (debounce) ou
  // Enter. Sem isso, cada tecla re-renderizava sidebar, paineis e lista.
  const [searchDraft, setSearchDraft] = useState(search)
  const searchDebounceRef = useRef(null)

  const profileRef = useRef(null)
  const bellRef = useRef(null)
  const searchRef = useRef(null)

  const SEARCH_DEBOUNCE_MS = 300

  const commitSearch = (value) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = null
    onSearch(value)
  }

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
  }, [])

  // O valor autoritativo pode mudar por fora (ex.: limpeza em outro painel);
  // o rascunho acompanha quando ja nao ha edicao em andamento.
  useEffect(() => {
    // Um debounce pendente carrega o valor antigo: sem cancelar, ele reverteria
    // a mudanca vinda de fora poucos ms depois.
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = null
    setSearchDraft(search)
  }, [search])

  const handleSearchInput = (value) => {
    setSearchDraft(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null
      onSearch(value)
    }, SEARCH_DEBOUNCE_MS)
  }

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
    <>
    <header className="topbar">
      <div className="topbar-mobile-brand">
        <div className="brand-logo" style={{ width: 30, height: 30 }}>
          <img className="brand-favicon" src="/dindin-10-logo.png" alt="DinDin 10!" />
        </div>
      </div>

      {/* Período */}
      {showMonthNav && (
        <MonthNav
          monthKey={monthKey}
          isMonthPending={isMonthPending}
          isCurrent={isCurrent}
          onMonthChange={onMonthChange}
        />
      )}

      <div className="topbar-spacer" />

      {/* Pesquisa */}
      <div className={`topbar-search${searchOpen ? ' open' : ''}`}>
        <Search size={15} strokeWidth={2} />
        <input
          ref={searchRef}
          type="search"
          value={searchDraft}
          onChange={(event) => handleSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitSearch(searchDraft)
          }}
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

          <div className={`popover glass-popover notification-popover${bellOpen ? ' is-open' : ''}`} role="dialog" aria-label="Notificações" aria-hidden={!bellOpen}>
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
                    tabIndex={bellOpen ? 0 : -1}
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
        </div>

        <button
          type="button"
          className={`topbar-btn${privacyVisible ? '' : ' active'}`}
          onClick={onTogglePrivacy}
          title={privacyVisible ? 'Ocultar valores' : 'Mostrar valores'}
          aria-label={privacyVisible ? 'Ocultar valores financeiros' : 'Mostrar valores financeiros'}
          aria-pressed={!privacyVisible}
        >
          {privacyVisible ? <Eye size={18} strokeWidth={1.9} /> : <EyeOff size={18} strokeWidth={1.9} />}
        </button>

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
            className={`topbar-btn topbar-profile-btn${profileOpen ? ' active' : ''}`}
            onClick={() => setProfileOpen((open) => !open)}
            title={user?.email}
            aria-label="Menu da conta"
            aria-expanded={profileOpen}
            style={{ width: 34 }}
          >
            <span className="avatar">{initials(user?.email)}</span>
          </button>

          <div className={`popover glass-popover${profileOpen ? ' is-open' : ''}`} role="menu" aria-label="Conta" aria-hidden={!profileOpen}>
              <div className="popover-head">
                <div className="popover-title">Conta</div>
                <div className="popover-sub" title={user?.email}>{user?.email}</div>
              </div>
              <button type="button" className="popover-item danger" onClick={onSignOut} role="menuitem" tabIndex={profileOpen ? 0 : -1}>
                <LogOut size={16} strokeWidth={1.9} />
                Sair da conta
              </button>
          </div>
        </div>
      </div>
    </header>

    {showMonthNav && <div className="month-nav-scroll">
      <MonthNav
        monthKey={monthKey}
        isMonthPending={isMonthPending}
        isCurrent={isCurrent}
        onMonthChange={onMonthChange}
      />
    </div>}
    </>
  )
}
