import { useEffect, useState } from 'react'

/**
 * Estado persistido no localStorage.
 * Funciona igual ao useState, mas grava as mudancas no navegador.
 *
 * `key` e `initialValue` entram nas dependencias de proposito. Antes um
 * `keyRef.current` alimentava o efeito com deps `[value]`: trocar de chave em
 * um render fazia o hook ler da chave antiga (o useState inicial ja rodou) e
 * gravar na nova, e o exhaustive-deps nunca ia avisar porque a regra ignora
 * leitura de ref.current - por isso o B36 nao pegaria isto. Os dois chamadores
 * de hoje passam literal (App.jsx:136 e useSupabaseFinance.js:122), entao o
 * comportamento em producao nao muda: some so a armadilha (B47).
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

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // quota cheia ou modo privado: ignora silenciosamente
    }
  }, [key, value])

  return [value, setValue]
}
