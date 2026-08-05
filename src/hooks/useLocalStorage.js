import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Estado persistido no localStorage.
 * Funciona igual ao useState, mas grava as mudancas no navegador.
 */
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return initialValue
      return JSON.parse(raw)
    } catch {
      return initialValue
    }
  })

  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    try {
      window.localStorage.setItem(keyRef.current, JSON.stringify(value))
    } catch {
      // quota cheia ou modo privado: ignora silenciosamente
    }
  }, [value])

  const reset = useCallback(() => {
    setValue(initialValue)
    try {
      window.localStorage.removeItem(keyRef.current)
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return [value, setValue, reset]
}
