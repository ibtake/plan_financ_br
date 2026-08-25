import { createContext, useCallback, useContext, useState } from 'react'
import { countCatalogOverrides } from '../utils/iconRegistry.js'

const IconContext = createContext()

/**
 * V-11: so aceitamos data URL de PNG. O valor vive no localStorage e e usado
 * direto como src de <img>; validar aqui impede que um valor adulterado
 * (extensao, outra aba, script) injete um src arbitrario.
 */
export function isSafeIconDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/png;base64,')
}

/** Remove qualquer entrada cujo valor nao seja um PNG data URL valido */
function sanitizeOverrides(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const clean = {}
  for (const [emoji, dataUrl] of Object.entries(raw)) {
    if (isSafeIconDataUrl(dataUrl)) clean[emoji] = dataUrl
  }
  return clean
}

const STORAGE_KEY = 'planejador:icon-overrides'

/** Mensagem unica dos dois pontos que enviam PNG: IconManager e o IconPicker de CategoryManager */
export const STORAGE_FULL_MESSAGE =
  'Armazenamento deste navegador cheio. Remova alguns ícones personalizados e tente de novo.'

/**
 * Grava os overrides no localStorage e devolve false quando a cota estourou,
 * para quem chamou reverter e avisar (B74). Antes o setItem vivia num efeito com
 * `catch` mudo: o icone entrava no state, nao persistia, e o usuario so descobria
 * no reload, achando que o app tinha desfeito a personalizacao. A escrita e
 * sincrona com a acao de proposito, para o resultado voltar a quem chamou.
 */
function writeOverrides(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

/**
 * Contexto global para gerenciar os overrides de emoji → PNG.
 * Cada override e uma entrada { '🏠': 'data:image/png;base64,...', ... }
 * persistida em localStorage.
 */
export function IconProvider({ children }) {
  const [overrides, setOverrides] = useState(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return {}
      return sanitizeOverrides(JSON.parse(raw))
    } catch {
      return {}
    }
  })

  const setOverride = useCallback((emoji, dataUrl) => {
    if (!isSafeIconDataUrl(dataUrl)) return false
    const next = { ...overrides, [emoji]: dataUrl }
    // B74: so aplica se persistiu. Cota cheia -> nao entra no state (nada de
    // icone que aparece e some no reload) e o chamador avisa (STORAGE_FULL_MESSAGE).
    if (!writeOverrides(next)) return false
    setOverrides(next)
    return true
  }, [overrides])

  const clearOverride = useCallback((emoji) => {
    const next = { ...overrides }
    delete next[emoji]
    writeOverrides(next)
    setOverrides(next)
  }, [overrides])

  const clearAll = useCallback(() => {
    writeOverrides({})
    setOverrides({})
  }, [])

  const getOverride = useCallback((emoji) => overrides[emoji], [overrides])
  const hasOverride = useCallback((emoji) => Boolean(overrides[emoji]), [overrides])
  // Progresso conta so o catalogo (B71). `storedCount` e o total gravado, orfaos
  // incluidos, porque e o "Restaurar tudo" do IconManager que precisa enxerga-los
  // para poder limpa-los - filtrar aqui esconderia o botao e prenderia o orfao.
  const overrideCount = countCatalogOverrides(overrides)
  const storedCount = Object.keys(overrides).length

  return (
    <IconContext.Provider value={{ overrides, setOverride, clearOverride, clearAll, getOverride, hasOverride, overrideCount, storedCount }}>
      {children}
    </IconContext.Provider>
  )
}

export function useIcons() {
  const ctx = useContext(IconContext)
  if (!ctx) throw new Error('useIcons deve ser usado dentro de <IconProvider>')
  return ctx
}
