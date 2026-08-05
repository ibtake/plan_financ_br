import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const IconContext = createContext()

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
      return JSON.parse(raw)
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
    setOverrides((prev) => ({ ...prev, [emoji]: dataUrl }))
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
