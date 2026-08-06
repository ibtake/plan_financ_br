import { useEffect, useRef, useState } from 'react'

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script'
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const siteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()

export function isTurnstileConfigured() {
  return Boolean(siteKey)
}

// A Site Key e publica. A Secret Key fica somente no Supabase, que valida o token.
export default function TurnstileCaptcha({ onTokenChange }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const onTokenChangeRef = useRef(onTokenChange)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange
  }, [onTokenChange])

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined
    let disposed = false
    const renderWidget = () => {
      if (disposed || !containerRef.current || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'auto',
        callback: (token) => onTokenChangeRef.current?.(token),
        'expired-callback': () => onTokenChangeRef.current?.(null),
        'error-callback': () => {
          onTokenChangeRef.current?.(null)
          setLoadError('Não foi possível validar a proteção anti-bot. Atualize a página e tente novamente.')
        },
      })
    }

    let script = document.getElementById(TURNSTILE_SCRIPT_ID)
    if (script) {
      if (window.turnstile) renderWidget()
      else script.addEventListener('load', renderWidget, { once: true })
    } else {
      script = document.createElement('script')
      script.id = TURNSTILE_SCRIPT_ID
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      script.addEventListener('load', renderWidget, { once: true })
      script.addEventListener('error', () => setLoadError('Não foi possível carregar a proteção anti-bot. Atualize a página e tente novamente.'), { once: true })
      document.head.appendChild(script)
    }

    return () => {
      disposed = true
      onTokenChangeRef.current?.(null)
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [])

  if (!siteKey) return null
  return (
    <div className="turnstile-wrap">
      <div ref={containerRef} />
      {loadError && <p className="text-xs text-danger" role="alert" style={{ margin: 0 }}>{loadError}</p>}
    </div>
  )
}
