import { createContext, useCallback, useContext, useEffect, useState } from 'react'

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

/**
 * Contexto global para gerenciar os overrides de emoji → PNG.
 * Cada override e uma entrada { '🏠': 'data:image/png;base64,...', ... }
 * persistida em localStorage.
 */
export function IconProvider({ children }) {
  const [overrides, setOverrides] = useState(() => {
    try {
      const raw = window.localStorage.getItem('planejador:icon-overrides')
      if (!raw) return {}
      return sanitizeOverrides(JSON.parse(raw))
    } catch {
      return {}
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem('planejador:icon-overrides', JSON.stringify(overrides))
    } catch {
      // quota cheia: ignora
    }
  }, [overrides])

  const setOverride = useCallback((emoji, dataUrl) => {
    if (!isSafeIconDataUrl(dataUrl)) return false
    setOverrides((prev) => ({ ...prev, [emoji]: dataUrl }))
    return true
  }, [])

  const clearOverride = useCallback((emoji) => {
    setOverrides((prev) => {
      const next = { ...prev }
      delete next[emoji]
      return next
    })
  }, [])

  const clearAll = useCallback(() => setOverrides({}), [])

  const getOverride = useCallback((emoji) => overrides[emoji], [overrides])
  const hasOverride = useCallback((emoji) => Boolean(overrides[emoji]), [overrides])
  const overrideCount = Object.keys(overrides).length

  return (
    <IconContext.Provider value={{ overrides, setOverride, clearOverride, clearAll, getOverride, hasOverride, overrideCount }}>
      {children}
    </IconContext.Provider>
  )
}

export function useIcons() {
  const ctx = useContext(IconContext)
  if (!ctx) throw new Error('useIcons deve ser usado dentro de <IconProvider>')
  return ctx
}
