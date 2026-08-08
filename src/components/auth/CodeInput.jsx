// Campo de 6 digitos para codigo TOTP, otimizado para celular.
// Aceita colar o codigo inteiro e avanca/retrocede automaticamente.

import { useEffect, useRef } from 'react'

export default function CodeInput({ value, onChange, disabled, autoFocus = true }) {
  const refs = useRef([])
  const digits = String(value || '').padEnd(6, ' ').slice(0, 6).split('')

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const setDigit = (index, digit) => {
    const current = String(value || '').padEnd(6, ' ').split('')
    current[index] = digit || ' '
    onChange(current.join('').replace(/\s/g, ''))
  }

  const handleChange = (index, raw) => {
    const only = raw.replace(/\D/g, '')
    if (!only) {
      setDigit(index, '')
      return
    }
    // Colagem do codigo completo
    if (only.length > 1) {
      onChange(only.slice(0, 6))
      refs.current[Math.min(only.length, 5)]?.focus()
      return
    }
    setDigit(index, only)
    if (index < 5) refs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !digits[index].trim() && index > 0) {
      refs.current[index - 1]?.focus()
    }
    if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 5) refs.current[index + 1]?.focus()
  }

  return (
    <div className="code-input" role="group" aria-label="Código de verificação de 6 dígitos">
      {digits.map((digit, index) => (
        <input
          key={index}
          name={`verification-code-${index + 1}`}
          ref={(el) => (refs.current[index] = el)}
          className="code-digit mono"
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          value={digit.trim()}
          disabled={disabled}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onFocus={(e) => e.target.select()}
          aria-label={`Dígito ${index + 1}`}
        />
      ))}
    </div>
  )
}
