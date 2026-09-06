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
        // Marca local de passkey (IMPR-010): so diz que ESTE navegador registrou
        // passkey nesta conta. Passkey sincronizada de outro aparelho nao aparece.
        hasPasskey: item?.hasPasskey === true,
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

    /**
     * Registra, ou promove a mais recente, a conta deste navegador. Chamado
     * cego pelo authSession a cada sessao: preserva o hasPasskey existente, para
     * o login que gravou a marca nao apagar na proxima entrada por senha.
     */
    remember(email) {
      const normalized = normalizeEmail(email)
      if (!normalized.includes('@')) return false
      const lista = readList(storage)
      const anterior = lista.find((item) => item.email === normalized)
      const outras = lista.filter((item) => item.email !== normalized)
      return writeList(
        storage,
        [{ email: normalized, lastUsedAt: Date.now(), hasPasskey: anterior?.hasPasskey === true }, ...outras].slice(0, MAX_ACCOUNTS),
      )
    },

    /** Marca que este navegador registrou passkey nesta conta (IMPR-010). */
    markPasskey(email) {
      const normalized = normalizeEmail(email)
      if (!normalized.includes('@')) return false
      const lista = readList(storage)
      const outras = lista.filter((item) => item.email !== normalized)
      const anterior = lista.find((item) => item.email === normalized)
      return writeList(
        storage,
        [{ email: normalized, lastUsedAt: anterior?.lastUsedAt || Date.now(), hasPasskey: true }, ...outras].slice(0, MAX_ACCOUNTS),
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

/**
 * Etapa em que a tela de login abre (TASK-006).
 *
 * Escolher conta so faz sentido com duas ou mais lembradas. Com exatamente
 * uma, a tela abre direto na senha com o e-mail ja identificado; com nenhuma,
 * no formulario tradicional. `selected` alimenta tanto a identidade exibida
 * quanto o input oculto que o gerenciador de senhas usa para casar a credencial.
 */
export function initialLoginStep(list) {
  if (list.length > 1) return { mode: 'accounts', selected: null }
  return { mode: 'login', selected: list.length === 1 ? list[0].email : null }
}

