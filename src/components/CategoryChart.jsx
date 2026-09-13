import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, MinusCircle, PieChart as PieChartIcon } from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import ChartInfoTooltip from './ChartInfoTooltip.jsx'
import { getCategory } from '../utils/categories.js'
import { formatCurrency, formatPercent } from '../utils/format.js'

const SMALL_CATEGORY_SHARE = 5
const HEX_COLUMNS = 18
const HEX_ROWS = 11
// Geometria pointy-top de hexágono regular: altura = largura * 1.1547,
// passo vertical = 75% da altura (+ respiro) e linhas alternadas deslocadas
// meia célula — mesmas proporções do desenho de referência (42×48.5, passo 46×39.4).
const HEX_UNIT_X = 46
const HEX_UNIT_Y = 39.4
const HEX_W = 42
const HEX_H = 48.5
const HEX_GRID_W = HEX_COLUMNS * HEX_UNIT_X + HEX_UNIT_X / 2
const HEX_GRID_H = (HEX_ROWS - 1) * HEX_UNIT_Y + HEX_H
// Hexágono pointy-top (ponta para cima) no box 42×48.5, cantos arredondados —
// mesma silhueta do desenho de referência.
const HEX_PATH = 'M16.67 2.5 Q21 0 25.33 2.5 L37.67 9.625 Q42 12.125 42 17.125 L42 31.375 Q42 36.375 37.67 38.875 L25.33 46 Q21 48.5 16.67 46 L4.33 38.875 Q0 36.375 0 31.375 L0 17.125 Q0 12.125 4.33 9.625 Z'

// Sombra de domo: centro mais claro que as bordas, dá a sensação de relevo.
// Overlay com gradiente radial em vez de fill chapado, funciona com qualquer cor.
function HexShape() {
  return (
    <svg viewBox="0 0 42 48.5" aria-hidden="true" focusable="false">
      <path d={HEX_PATH} fill="currentColor" />
      <path d={HEX_PATH} fill="url(#hex-dome-shade)" />
    </svg>
  )
}

function HexDomeGradient() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="hex-dome-shade" cx="50%" cy="40%" r="90%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity=".13" />
          <stop offset="56%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity=".10" />
        </radialGradient>
      </defs>
    </svg>
  )
}

function buildHexGrid(data) {
  const slots = []

  for (let row = 0; row < HEX_ROWS; row += 1) {
    for (let column = 0; column < HEX_COLUMNS; column += 1) {
      const x = column * HEX_UNIT_X + (row % 2 ? HEX_UNIT_X / 2 : 0)
      const y = row * HEX_UNIT_Y
      const xCenter = x + HEX_W / 2
      const yCenter = y + HEX_H / 2
      const xNorm = (xCenter - HEX_GRID_W / 2) / (HEX_GRID_W / 2)
      const yNorm = (yCenter - HEX_GRID_H / 2) / ((HEX_GRID_H / 2) * 1.15)

      // Moldura de "mesa": a fileira de borda nunca é usada — fica sempre
      // cinza-claro em volta do mapa. O jitter determinístico na fronteira
      // interna (estável entre renders) dá um recorte orgânico ao conjunto.
      const borderRow = row === 0 || row === HEX_ROWS - 1
      const borderCol = column === 0 || column === HEX_COLUMNS - 1
      const jitter = (((row + 1) * 73856093) ^ ((column + 1) * 19349663)) % 100 / 100
      const active = !borderRow && !borderCol
        && Math.hypot(xNorm, yNorm) <= 1.0 + (jitter - 0.5) * 0.16

      slots.push({
        row,
        column,
        x,
        y,
        xNorm,
        yNorm,
        radius: Math.hypot(xNorm, yNorm),
        active,
        category: null
      })
    }
  }

  const activeSlots = slots.filter((slot) => slot.active)
  if (!activeSlots.length || !data.length) return slots

  // Ilha central: a menor categoria vira um bloco compacto no centro.
  // As demais categorias (maiores primeiro) entram como ilhas contíguas
  // em torno dela, por varredura angular — blocos de região, não anéis.
  const byRadius = [...activeSlots].sort((a, b) => a.radius - b.radius)
  const byAngle = (a, b) => Math.atan2(a.yNorm, a.xNorm) - Math.atan2(b.yNorm, b.xNorm)
  const descending = [...data].sort((a, b) => b.share - a.share)
  const smallest = descending[descending.length - 1]
  const totalSlots = activeSlots.length

  const centerCount = Math.max(1, Math.round((smallest.share / 100) * totalSlots))
  byRadius.slice(0, centerCount).forEach((slot) => { slot.category = smallest })

  const ring = byRadius.slice(centerCount).sort(byAngle)
  let slotIndex = 0

  descending.slice(0, -1).forEach((item) => {
    const island = ring.slice(slotIndex, slotIndex + Math.max(1, Math.round((item.share / 100) * totalSlots)))
    island.forEach((slot) => { slot.category = item })
    slotIndex += island.length
  })

  // Sobras de arredondamento viram a maior categoria, contígua na borda externa
  while (slotIndex < ring.length) {
    ring[slotIndex].category = descending[0]
    slotIndex++
  }

  return slots
}

const hexPosition = (hex) => ({
  left: `${((hex.x / HEX_GRID_W) * 100).toFixed(3)}%`,
  top: `${((hex.y / HEX_GRID_H) * 100).toFixed(3)}%`,
  width: `${((HEX_W / HEX_GRID_W) * 100).toFixed(3)}%`,
  height: `${((HEX_H / HEX_GRID_H) * 100).toFixed(3)}%`,
})

function getStatus(item) {
  if (item.target <= 0) return { tone: 'neutral', label: 'Sem meta', Icon: MinusCircle }
  const ratio = item.share / item.target
  if (ratio > 1.01) return { tone: 'danger', label: 'Acima da meta', Icon: AlertTriangle }
  if (ratio >= 0.9) return { tone: 'warning', label: 'Atenção', Icon: AlertTriangle }
  return { tone: 'success', label: 'Dentro da meta', Icon: CheckCircle2 }
}

function ShowAllButton({ expanded, onClick }) {
  return <button type="button" className="category-show-all" onClick={onClick}>{expanded ? 'Ver menos categorias' : 'Ver todas as categorias'}<ChevronRight size={16} aria-hidden="true" /></button>
}

export default function CategoryChart({ byCategory, categories, total, incomeTotal = 0 }) {
  const [activeId, setActiveId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [selectedHex, setSelectedHex] = useState(null)
  const [liftedId, setLiftedId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const hexRefs = useRef(new Map())
  const gridRef = useRef(null)
  const springsRef = useRef([])
  const liftRef = useRef(null)
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  const startRef = useRef(() => {})

  const data = useMemo(() => {
    const rawData = Object.entries(byCategory).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([id, value]) => {
      const cat = getCategory(categories, id)
      const target = Math.max(0, Math.min(100, Number(cat.targetPercentage) || 0))
      const share = total > 0 ? (value / total) * 100 : 0
      const targetValue = total * (target / 100)
      return { id, name: cat.name, icon: cat.icon, color: cat.color, value, share, target, targetValue, difference: value - targetValue }
    })
    const small = rawData.filter((item) => item.share < SMALL_CATEGORY_SHARE)
    const regular = rawData.filter((item) => item.share >= SMALL_CATEGORY_SHARE)
    const grouped = small.length ? [{ id: 'other-categories', name: 'Outras categorias', icon: '⋯', color: '#94a3b8', value: small.reduce((sum, item) => sum + item.value, 0), share: small.reduce((sum, item) => sum + item.share, 0), target: small.reduce((sum, item) => sum + item.target, 0), targetValue: small.reduce((sum, item) => sum + item.targetValue, 0), difference: small.reduce((sum, item) => sum + item.difference, 0), items: small }] : []
    return [...regular, ...grouped]
  }, [byCategory, categories, total])

  const displayedLegend = showAll ? data : data.slice(0, 7)
  const displayedRows = showAll ? data : data.slice(0, 7)
  const toggleAll = () => setShowAll((value) => !value)

  const hexGrid = useMemo(() => buildHexGrid(data), [data])
  const focusedId = hoveredId || selectedHex?.id || liftedId || activeId
  const selectedItem = data.find((item) => item.id === selectedHex?.id)

  // ---- molas orgânicas (hover + seleção) ----
  // Cada hexágono é uma mola sub-amortecida. O cursor define uma altura-alvo
  // com decaimento gaussiano pela distância (o hex apontado sobe, os vizinhos
  // acompanham em degradê e tudo assenta com balanço suave). A categoria
  // selecionada por clique mantém um patamar constante de elevação.
  const SPRING_MAX_LIFT = 7
  const SPRING_SELECT_LIFT = 5
  const SPRING_SIGMA = 55
  const SPRING_STIFFNESS = 170
  const SPRING_DAMPING = 9

  useEffect(() => { liftRef.current = liftedId }, [liftedId])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const springs = springsRef.current
    const mouse = mouseRef.current
    let rafId = null
    let lastT = 0

    const measure = () => {
      springs.length = 0
      hexRefs.current.forEach((el) => {
        springs.push({
          el,
          cls: el.dataset.categoryId,
          cx: el.offsetLeft + el.offsetWidth / 2,
          cy: el.offsetTop + el.offsetHeight / 2,
          z: 0,
          v: 0
        })
      })
    }
    measure()

    const tick = (now) => {
      const dt = Math.min((now - lastT) / 1000, 0.033)
      lastT = now
      let active = false

      for (const spring of springs) {
        let target = 0
        let pull = 0
        if (mouse.inside) {
          const dx = spring.cx - mouse.x
          const dy = spring.cy - mouse.y
          const d2 = dx * dx + dy * dy
          if (d2 < (3 * SPRING_SIGMA) ** 2) {
            const falloff = Math.exp(-d2 / (2 * SPRING_SIGMA * SPRING_SIGMA))
            target = SPRING_MAX_LIFT * falloff
            // inclina levemente na direção do cursor ("puxar")
            pull = Math.max(-3, Math.min(3, -dx * 0.05)) * falloff
          }
        }
        if (spring.cls && spring.cls === liftRef.current) target = Math.max(target, SPRING_SELECT_LIFT)

        spring.v += (SPRING_STIFFNESS * (target - spring.z) - SPRING_DAMPING * spring.v) * dt
        spring.z += spring.v * dt

        if (Math.abs(target - spring.z) > 0.02 || Math.abs(spring.v) > 0.02) active = true

        const intensity = Math.max(0, spring.z / SPRING_MAX_LIFT)
        spring.el.style.transform =
          `translate(${(pull * intensity).toFixed(2)}px, ${(-spring.z).toFixed(2)}px) scale(${(1 + 0.055 * intensity).toFixed(4)})`
        spring.el.style.filter =
          `drop-shadow(0 ${(1 + 2.5 * intensity).toFixed(1)}px ${(1.5 + 3 * intensity).toFixed(1)}px rgb(0 0 0 / ${Math.round((18 + 16 * intensity))}%))`
        spring.el.style.zIndex = 10 + Math.round(spring.z)
      }

      rafId = active ? requestAnimationFrame(tick) : null
    }

    const start = () => {
      if (rafId === null && !reduced) {
        lastT = performance.now()
        rafId = requestAnimationFrame(tick)
      }
    }
    startRef.current = start

    const onMove = (event) => {
      const rect = grid.getBoundingClientRect()
      mouse.x = event.clientX - rect.left
      mouse.y = event.clientY - rect.top
      mouse.inside = true
      start()
    }
    const onLeave = () => {
      mouse.inside = false
      start()
    }
    const onResize = () => measure()

    grid.addEventListener('pointermove', onMove)
    grid.addEventListener('pointerleave', onLeave)
    window.addEventListener('resize', onResize)

    return () => {
      grid.removeEventListener('pointermove', onMove)
      grid.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', onResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = null
      startRef.current = () => {}
    }
  }, [hexGrid])

  const handleHexClick = (event, category) => {
    const wrap = event.currentTarget.closest('.expense-hex-wrap')
    if (selectedHex?.id === category.id) {
      setSelectedHex(null)
      setActiveId(null)
      setLiftedId(null)
      // sem isso, o cursor parado sobre a categoria mantém o foco de hover
      // e o gráfico "parece" ainda selecionado após deselecionar
      setHoveredId(null)
    } else {
      const hexRect = event.currentTarget.getBoundingClientRect()
      const wrapRect = wrap.getBoundingClientRect()
      setActiveId(category.id)
      setLiftedId(category.id)
      setSelectedHex({ id: category.id, left: hexRect.left - wrapRect.left + (hexRect.width / 2), top: hexRect.top - wrapRect.top + (hexRect.height / 2) })
    }
    startRef.current()
  }

  const handleHexWrapClick = (event) => {
    if (event.target.closest('.expense-hex:not(.is-empty)')) return
    setSelectedHex(null)
    setActiveId(null)
    setLiftedId(null)
    setHoveredId(null)
    startRef.current()
  }

  if (!data.length) return <div className="card"><div className="card-head"><div><div className="card-title">Distribuição das despesas</div><div className="card-sub">Total gasto no mês</div></div></div><div className="empty"><div className="empty-icon"><PieChartIcon size={22} strokeWidth={1.6} /></div><div className="empty-title">Nenhuma saída neste mês</div><div className="text-sm">Adicione lançamentos para ver a distribuição.</div></div></div>

  return <div className="expense-cards-layout">
    <section className="card expense-distribution-card">
      <div className="card-head"><div><div className="card-title">Distribuição das despesas</div><div className="card-sub">Total gasto no mês</div></div></div>
      <div className="expense-hex-wrap" onClick={handleHexWrapClick}>
        <HexDomeGradient />
        <div className="expense-hex-grid" ref={gridRef} role="group" aria-label="Distribuição por classe de despesa">
          {hexGrid.map((hex) => {
            return hex.category ? (
              <button
                type="button"
                key={`${hex.row}-${hex.column}`}
                className={`expense-hex${focusedId && focusedId !== hex.category.id ? ' is-dimmed' : ''}`}
                ref={(element) => { if (element) hexRefs.current.set(`${hex.row}-${hex.column}`, element); else hexRefs.current.delete(`${hex.row}-${hex.column}`) }}
                style={{ ...hexPosition(hex), '--hex-color': hex.category.color }}
                data-category-id={hex.category.id}
                onMouseEnter={() => setHoveredId(hex.category.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(hex.category.id)}
                onBlur={() => setHoveredId(null)}
                onClick={(event) => handleHexClick(event, hex.category)}
                aria-label={`${hex.category.name}: ${formatCurrency(hex.category.value)}`}
              ><HexShape /></button>
            ) : (
              <span
                className="expense-hex is-empty"
                key={`${hex.row}-${hex.column}`}
                style={hexPosition(hex)}
                aria-hidden="true"
              ><HexShape /></span>
            )
          })}
        </div>
        {selectedHex && selectedItem && <div className="expense-hex-tooltip" style={{ left: selectedHex.left, top: selectedHex.top }}><ChartInfoTooltip title={selectedItem.name} value={formatCurrency(selectedItem.value)} color={selectedItem.color} detail={`${formatPercent(selectedItem.share, 1)} do total`} /></div>}
      </div>
      <div className="expense-donut-legend">{displayedLegend.map((item) => <button type="button" key={item.id} className={`expense-legend-row${activeId === item.id ? ' is-active' : ''}`} onMouseEnter={() => setActiveId(item.id)} onMouseLeave={() => setActiveId(null)} onClick={() => { setActiveId(item.id); setSelectedHex(null); setLiftedId((current) => current === item.id ? null : item.id); startRef.current() }} aria-label={`${item.name}: ${formatCurrency(item.value)}, ${formatPercent(item.share, 1)} do total`}><span className="chart-dot" style={{ background: item.color }} /><span className="expense-legend-name"><AppIcon emoji={item.icon} /> {item.name}</span><strong>{formatCurrency(item.value)}</strong><span>{formatPercent(item.share, 1)}</span></button>)}</div>
      {data.length > 7 && <ShowAllButton expanded={showAll} onClick={toggleAll} />}
    </section>

    <section className="card expense-analysis-card">
      <div className="card-head"><div><div className="card-title">Por categoria</div><div className="card-sub">Análise detalhada dos gastos</div></div></div>
      <div className="expense-analysis-head" aria-hidden="true"><span>Categoria</span><span>Meta<br />(%)</span><span>Real<br />(%)</span><span>Diferença<br />(R$)</span><span>Diferença<br />(p.p.)</span><span>Status</span></div>
      <div className="expense-analysis-list">{displayedRows.map((item) => {
        const status = getStatus(item); const prefix = item.difference >= 0 ? '+' : '−'; const percentageDifference = item.target > 0 ? item.share - item.target : 0; const expanded = expandedId === item.id
        const toggleExpanded = () => { setActiveId(item.id); setExpandedId((current) => current === item.id ? null : item.id) }
        return <button type="button" key={item.id} className={`expense-analysis-row${activeId === item.id ? ' is-active' : ''}${expanded ? ' is-expanded' : ''}`} onMouseEnter={() => setActiveId(item.id)} onMouseLeave={() => setActiveId(null)} onClick={toggleExpanded} aria-expanded={expanded} aria-controls={`mobile-category-details-${item.id}`} aria-label={`${item.name}: ${formatCurrency(item.value)}, ${formatPercent(item.share, 1)} do total. ${status.label}. ${expanded ? 'Fechar' : 'Abrir'} detalhes.`}><span className="expense-category-cell"><span className="expense-category-icon"><AppIcon emoji={item.icon} /></span><span className="expense-category-copy"><strong>{item.name}</strong><span className="expense-share-bar"><span style={{ width: `${Math.min(item.share, 100)}%`, background: item.color }} /></span><small>{formatCurrency(item.value)}</small></span></span><span data-label="Meta">{formatPercent(item.target, 0)}</span><span data-label="Real">{formatPercent(item.share, 0)}</span><span data-label="Diferença R$" className={item.difference > 0 ? 'difference-danger' : 'difference-success'}>{prefix}{formatCurrency(Math.abs(item.difference))}</span><span data-label="Diferença p.p." className={percentageDifference > 0 ? 'difference-danger' : 'difference-success'}>{prefix}{formatPercent(Math.abs(percentageDifference), 0)} p.p.</span><span className={`expense-status status-${status.tone}`}><status.Icon size={14} aria-hidden="true" />{status.label}</span><span className="mobile-category-summary"><span className="mobile-category-top"><span className="expense-category-icon"><AppIcon emoji={item.icon} /></span><strong>{item.name}</strong><span className={`mobile-category-status status-${status.tone}`}><status.Icon size={15} aria-hidden="true" />{status.label}</span><ChevronDown className="mobile-category-chevron" size={17} aria-hidden="true" /></span><span className="expense-share-bar"><span style={{ width: `${Math.min(item.share, 100)}%`, background: item.color }} /></span><span className="mobile-category-footer"><strong>{formatCurrency(item.value)}</strong><span>{formatPercent(item.share, 0)} do total</span></span></span><span className="mobile-category-details" id={`mobile-category-details-${item.id}`}><span className="mobile-category-details-inner"><span><small>Meta</small><strong>{formatPercent(item.target, 0)}</strong></span><span><small>Real</small><strong>{formatPercent(item.share, 0)}</strong></span><span className={item.difference > 0 ? 'difference-danger' : 'difference-success'}><small>Diferença</small><strong>{prefix}{formatCurrency(Math.abs(item.difference))}</strong></span><span className={percentageDifference > 0 ? 'difference-danger' : 'difference-success'}><small>Diferença p.p.</small><strong>{prefix}{formatPercent(Math.abs(percentageDifference), 0)} p.p.</strong></span><span className={`mobile-detail-status status-${status.tone}`}><small>Status</small><strong><status.Icon size={14} aria-hidden="true" />{status.label}</strong></span></span></span></button>
      })}</div>
      {data.length > 7 && <ShowAllButton expanded={showAll} onClick={toggleAll} />}
    </section>
  </div>
}
