import { useEffect, useMemo, useRef, useState } from 'react'
import { SearchX } from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import { useIcons, STORAGE_FULL_MESSAGE } from '../contexts/IconContext.jsx'
import { ICON_CATALOG, ICON_GROUPS, TOTAL_ICONS } from '../utils/iconRegistry.js'
import { estimateStorageBytes, readIconFile } from '../utils/iconUpload.js'

/** Linha da tabela: um emoji, onde ele aparece e o controle de substituicao */
function IconRow({ item, replaced, onUpload, onClear, busy }) {
  const inputRef = useRef(null)

  return (
    <div className={`icon-row${replaced ? ' is-replaced' : ''}`}>
      <div className="icon-row-preview">
        <AppIcon emoji={item.emoji} size={30} />
      </div>

      <div className="icon-row-info">
        <div className="icon-row-label">{item.label}</div>
        <div className="icon-row-usage">{item.usage}</div>
      </div>

      <div className="icon-row-status">
        {replaced ? (
          <span className="badge badge-ok">PNG aplicado</span>
        ) : (
          <span className="badge badge-muted">Emoji original</span>
        )}
      </div>

      <div className="icon-row-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onUpload(item.emoji, file)
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {replaced ? 'Trocar' : 'Enviar PNG'}
        </button>
        {replaced && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onClear(item.emoji)}>
            Remover
          </button>
        )}
      </div>
    </div>
  )
}

export default function IconManager() {
  const { overrides, setOverride, clearOverride, clearAll, overrideCount, storedCount } = useIcons()
  const [group, setGroup] = useState('all')
  const [search, setSearch] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const messageTimer = useRef(0)

  const notify = (text, kind = 'ok') => {
    setMessage({ text, kind })
    // Cancela o timer anterior, senao o dele apaga esta mensagem antes dos 4 s:
    // trocar dois icones em sequencia encurta a segunda confirmacao, e um
    // `notify(error.message, 'danger')` logo depois de um sucesso podia aparecer
    // por milissegundos. Serve tambem de limpeza no unmount, no efeito abaixo.
    window.clearTimeout(messageTimer.current)
    messageTimer.current = window.setTimeout(() => setMessage(null), 4000)
  }

  useEffect(() => () => window.clearTimeout(messageTimer.current), [])

  const handleUpload = async (emoji, file) => {
    setBusy(true)
    try {
      const dataUrl = await readIconFile(file)
      if (setOverride(emoji, dataUrl)) {
        notify('Ícone aplicado. A mudança já aparece em todas as telas.')
      } else {
        notify(STORAGE_FULL_MESSAGE, 'danger')
      }
    } catch (error) {
      notify(error.message, 'danger')
    } finally {
      setBusy(false)
    }
  }

  const handleClear = (emoji) => {
    clearOverride(emoji)
    notify('Ícone restaurado para o emoji original.')
  }

  const handleClearAll = () => {
    if (!storedCount) return
    if (window.confirm(`Restaurar os ${storedCount} ícones personalizados para os emojis originais?`)) {
      clearAll()
      notify('Todos os ícones voltaram ao padrão.')
    }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return ICON_CATALOG.filter((item) => {
      if (group !== 'all' && item.group !== group) return false
      if (onlyPending && overrides[item.emoji]) return false
      if (!term) return true
      return (
        item.label.toLowerCase().includes(term) ||
        item.usage.toLowerCase().includes(term) ||
        item.emoji === term
      )
    })
  }, [group, onlyPending, overrides, search])

  const grouped = useMemo(() => {
    const buckets = new Map()
    for (const item of visible) {
      if (!buckets.has(item.group)) buckets.set(item.group, [])
      buckets.get(item.group).push(item)
    }
    return buckets
  }, [visible])

  const progress = Math.round((overrideCount / TOTAL_ICONS) * 100)
  const storageKb = Math.round(estimateStorageBytes(overrides) / 1024)

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Personalização de ícones</div>
            <div className="card-sub">
              Substitua os emojis por PNG conforme validar cada tela. As mudanças valem para toda a
              aplicação e ficam salvas neste navegador.
            </div>
          </div>
          {storedCount > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={handleClearAll}>
              Restaurar tudo
            </button>
          )}
        </div>

        <div className="icon-progress">
          <div className="icon-progress-bar">
            <div className="icon-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="icon-progress-meta">
            <strong>{overrideCount}</strong> de {TOTAL_ICONS} ícones substituídos ({progress}%)
            {storageKb > 0 && <span className="icon-progress-size"> · {storageKb} KB armazenados</span>}
          </div>
        </div>

        {message && <div className={`notice ${message.kind === 'danger' ? 'danger' : 'success'}`} role={message.kind === 'danger' ? 'alert' : 'status'}>{message.text}</div>}

        <div className="icon-toolbar">
          <label className="sr-only" htmlFor="icon-manager-search">Buscar ícone</label>
          <input
            id="icon-manager-search"
            className="input"
            type="search"
            placeholder="Buscar por nome ou tela..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="sr-only" htmlFor="icon-manager-group">Grupo de ícones</label>
          <select id="icon-manager-group" className="input" value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="all">Todos os grupos ({TOTAL_ICONS})</option>
            {ICON_GROUPS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <label className="icon-toggle">
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(event) => setOnlyPending(event.target.checked)}
            />
            <span>Só pendentes</span>
          </label>
        </div>

        <div className="icon-hint">
          Recomendado: PNG quadrado com fundo transparente, 128×128 px, até 1 MB. A imagem é
          redimensionada e reprocessada no seu navegador, sem envio para servidor.
        </div>
      </div>

      {visible.length === 0 && (
        <div className="card empty-state">
          <SearchX size={34} strokeWidth={1.6} />
          <div>Nenhum ícone corresponde ao filtro.</div>
        </div>
      )}

      {ICON_GROUPS.filter((section) => grouped.has(section.id)).map((section) => (
        <div className="card" key={section.id}>
          <div className="card-head">
            <div>
              <div className="card-title">{section.name}</div>
              <div className="card-sub">{section.hint}</div>
            </div>
            <span className="badge badge-muted">
              {grouped.get(section.id).filter((item) => overrides[item.emoji]).length}/
              {grouped.get(section.id).length}
            </span>
          </div>

          <div className="icon-list">
            {grouped.get(section.id).map((item) => (
              <IconRow
                key={item.emoji}
                item={item}
                replaced={Boolean(overrides[item.emoji])}
                onUpload={handleUpload}
                onClear={handleClear}
                busy={busy}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
