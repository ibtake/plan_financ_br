export const REVALIDATION_RETRY_DELAYS = Object.freeze([5000, 15000, 60000])

export function createRefreshCoordinator(refresh, { now = Date.now, queueAfterMs = 250 } = {}) {
  let inFlight = null
  let rerunRequested = false
  let startedAt = 0

  return () => {
    if (inFlight) {
      if (now() - startedAt >= queueAfterMs) rerunRequested = true
      return inFlight
    }

    startedAt = now()
    inFlight = (async () => {
      const firstResult = await refresh()
      if (!rerunRequested) return firstResult
      rerunRequested = false
      return refresh()
    })().finally(() => {
      inFlight = null
      rerunRequested = false
    })

    return inFlight
  }
}

export function retryDelay(attempt) {
  const index = Math.min(Math.max(Number(attempt) || 0, 0), REVALIDATION_RETRY_DELAYS.length - 1)
  return REVALIDATION_RETRY_DELAYS[index]
}

export function isRetryableConnectionError(error) {
  if (!error) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const status = Number(error.status || error.statusCode || 0)
  const code = String(error.code || '').toLowerCase()
  const message = String(error.message || error).toLowerCase()
  return status >= 500 || code === 'fetch_error' || code === 'etimedout' || code === 'econnreset' ||
    message.includes('failed to fetch') || message.includes('networkerror') ||
    message.includes('network request failed') || message.includes('load failed') ||
    message.includes('timeout') || message.includes('connection')
}

export function isCurrentLoad(captured, current) {
  return captured.requestId === current.requestId &&
    captured.userId === current.userId &&
    captured.sessionRevision === current.sessionRevision
}
