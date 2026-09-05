// =====================================================================
// Contas reconhecidas neste navegador (IMPR-009)
// =====================================================================
// Guarda apenas o e-mail de quem ja entrou neste navegador, para a tela de
// login oferecer a conta em vez de pedir o e-mail de novo. Nenhum segredo
// passa por aqui: senha, access token e refresh token seguem sob a
// responsabilidade do storage do proprio Supabase.
//
// Molde igual ao offlineDb.js: factory com storage injetavel (permite testar
// sem DOM) mais um singleton para o app.

const REMEMBERED_ACCOUNTS_KEY = 'planejador:remembered-accounts'
const MAX_ACCOUNTS = 5

/** Mesma normalizacao do signIn (authOperations.js), para o dedup casar. */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/**
 * Le a lista do storage. O conteudo e editavel pelo usuario, entao todo
 * registro e revalidado: fora do formato, some. Mais recente primeiro, sem
 * repetido (a lista vira key de lista no React).
 */
function readList(storage) {
  try {
    const value = JSON.parse(storage?.getItem(REMEMBERED_ACCOUNTS_KEY) || '[]')
    if (!Array.isArray(value)) return []
    const vistos = new Set()
    return value
      .map((item) => ({
        email: normalizeEmail(item?.email),
        lastUsedAt: Number(item?.lastUsedAt) || 0,
      }))
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .filter((item) => {
        if (!item.email.includes('@') || vistos.has(item.email)) return false
        vistos.add(item.email)
        return true
      })
      .slice(0, MAX_ACCOUNTS)
  } catch {
    return []
  }
}

function writeList(storage, list) {
  if (!storage) return false
  try {
    storage.setItem(REMEMBERED_ACCOUNTS_KEY, JSON.stringify(list))
    return true
  } catch {
    // Modo privado ou cota estourada: reconhecer a conta e um extra, nao um
    // requisito do login. Falha em silencio e a tela cai no formulario.
    return false
  }
}

export function createRememberedAccounts({
  storage = typeof localStorage === 'undefined' ? null : localStorage,
} = {}) {
  return {
    list: () => readList(storage),

    /** Registra, ou promove a mais recente, a conta deste navegador. */
    remember(email) {
      const normalized = normalizeEmail(email)
      if (!normalized.includes('@')) return false
      const outras = readList(storage).filter((item) => item.email !== normalized)
      return writeList(
        storage,
        [{ email: normalized, lastUsedAt: Date.now() }, ...outras].slice(0, MAX_ACCOUNTS),
      )
    },

    /** Esquece a conta neste navegador (acao explicita na tela de login). */
    forget(email) {
      const normalized = normalizeEmail(email)
      return writeList(storage, readList(storage).filter((item) => item.email !== normalized))
    },
  }
}

export const rememberedAccounts = createRememberedAccounts()
