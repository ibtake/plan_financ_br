const DB_NAME = 'dindin-offline'
const DB_VERSION = 1
const SNAPSHOT_STORE = 'snapshots'
export const OFFLINE_CACHE_PREFERENCE_KEY = 'planejador:offline-cache-preferences'
const PREFERENCE_KEY = OFFLINE_CACHE_PREFERENCE_KEY
const PURGE_KEY = 'planejador:offline-purge-pending'
const PURGE_EPOCH_KEY = 'planejador:offline-purge-epoch'
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024
const MAX_LIST_ITEMS = 100000
const OPEN_TIMEOUT_MS = 2000

export const OFFLINE_RESOURCES = Object.freeze([
  'transactions',
  'categories',
  'budgets',
  'goals',
  'reverseGoalHistory',
  'reverseGoalContributions',
  'standardGoalContributions',
  'reverseGoalEvents',
  'reverseGoalRetentionMonths',
  'transactionFormFields',
  'pgblPlans',
])

const LIST_RESOURCES = new Set([
  'transactions',
  'categories',
  'goals',
  'reverseGoalHistory',
  'reverseGoalContributions',
  'standardGoalContributions',
  'reverseGoalEvents',
])

const OBJECT_RESOURCES = new Set(['budgets', 'transactionFormFields', 'pgblPlans'])

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function serializedSize(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Infinity
  }
}

function safeStructuredValue(value, depth = 0) {
  if (depth > 8) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return typeof value !== 'string' || value.length <= 10000
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= MAX_LIST_ITEMS && value.every((item) => safeStructuredValue(item, depth + 1))
  if (!plainObject(value)) return false
  const entries = Object.entries(value)
  return entries.length <= 200 && entries.every(([key, item]) => key.length <= 200 && safeStructuredValue(item, depth + 1))
}

export function validateOfflineValue(resource, value) {
  if (!OFFLINE_RESOURCES.includes(resource) || serializedSize(value) > MAX_RESOURCE_BYTES) return false
  if (LIST_RESOURCES.has(resource)) {
    if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS || !value.every((item) => plainObject(item) && safeStructuredValue(item))) return false
    if (resource === 'transactions') return value.every((item) => typeof item.id === 'string' && typeof item.description === 'string' && typeof item.date === 'string' && Number.isFinite(item.amount))
    if (resource === 'categories') return value.every((item) => typeof item.id === 'string' && typeof item.name === 'string' && typeof item.type === 'string')
    if (resource === 'goals') return value.every((item) => typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(item.target) && Number.isFinite(item.current))
    return true
  }
  if (OBJECT_RESOURCES.has(resource)) {
    if (!plainObject(value) || !safeStructuredValue(value)) return false
    if (resource === 'budgets') return Object.values(value).every((amount) => Number.isFinite(amount) && amount >= 0)
    if (resource === 'transactionFormFields') return Object.values(value).every((visible) => typeof visible === 'boolean')
    if (resource === 'pgblPlans') return Object.values(value).every((plan) => plainObject(plan) && Number.isInteger(plan.year) && Array.isArray(plan.months))
  }
  if (OBJECT_RESOURCES.has(resource)) return true
  return resource === 'reverseGoalRetentionMonths' && (
    value === null || (Number.isInteger(value) && value >= 1 && value <= 12)
  )
}

export function validateSnapshotRecord(record, userId) {
  return plainObject(record) && record.userId === userId &&
    record.schemaVersion === 1 && Number.isFinite(record.fetchedAt) &&
    validateOfflineValue(record.resource, record.value)
}

function readMap(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) || '{}')
    return plainObject(value) ? value : {}
  } catch {
    return {}
  }
}

function writeMap(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'))
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('indexeddb_transaction_aborted'))
    transaction.onerror = () => reject(transaction.error || new Error('indexeddb_transaction_failed'))
  })
}

function errorCode(error) {
  const name = String(error?.name || '')
  if (name === 'VersionError') return 'version'
  if (name === 'AbortError') return 'aborted'
  if (name === 'QuotaExceededError') return 'quota'
  if (String(error?.message || '').includes('indexeddb_blocked')) return 'blocked'
  return 'unavailable'
}

export function createOfflineDb({
  indexedDBImpl = typeof indexedDB === 'undefined' ? null : indexedDB,
  storage = typeof localStorage === 'undefined' ? null : localStorage,
} = {}) {
  let connectionPromise = null
  const purgingUsers = new Set()

  const preferenceEnabled = (userId) => readMap(storage, PREFERENCE_KEY)[userId] === true
  const purgePending = (userId) => readMap(storage, PURGE_KEY)[userId] === true
  const purgeEpoch = (userId) => Number(readMap(storage, PURGE_EPOCH_KEY)[userId] || 0)

  const markPurge = (userId, pending) => {
    const values = readMap(storage, PURGE_KEY)
    if (pending) values[userId] = true
    else delete values[userId]
    writeMap(storage, PURGE_KEY, values)
  }

  const nextPurgeEpoch = (userId) => {
    const values = readMap(storage, PURGE_EPOCH_KEY)
    const epoch = purgeEpoch(userId) + 1
    values[userId] = epoch
    writeMap(storage, PURGE_EPOCH_KEY, values)
    return epoch
  }

  const clearPurge = (userId, expectedEpoch) => {
    if (purgeEpoch(userId) !== expectedEpoch) return
    markPurge(userId, false)
  }

  const open = () => {
    if (!indexedDBImpl) return Promise.reject(new Error('indexeddb_unavailable'))
    if (connectionPromise) return connectionPromise

    connectionPromise = new Promise((resolve, reject) => {
      let settled = false
      const request = indexedDBImpl.open(DB_NAME, DB_VERSION)
      const timeout = setTimeout(() => {
        settled = true
        reject(new Error('indexeddb_open_timeout'))
      }, OPEN_TIMEOUT_MS)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: ['userId', 'resource'] })
          store.createIndex('by-user', 'userId')
        }
      }
      request.onblocked = () => {
        clearTimeout(timeout)
        settled = true
        reject(new Error('indexeddb_blocked'))
      }
      request.onerror = () => {
        clearTimeout(timeout)
        settled = true
        reject(request.error || new Error('indexeddb_open_failed'))
      }
      request.onsuccess = () => {
        clearTimeout(timeout)
        if (settled) {
          request.result.close()
          return
        }
        settled = true
        const db = request.result
        db.onversionchange = () => db.close()
        db.onclose = () => { connectionPromise = null }
        resolve(db)
      }
    }).catch((error) => {
      connectionPromise = null
      throw error
    })

    return connectionPromise
  }

  const purgeUserWithEpoch = async (userId) => {
    if (!userId) return true
    const epoch = nextPurgeEpoch(userId)
    purgingUsers.add(userId)
    markPurge(userId, true)
    try {
      const db = await open()
      const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite')
      const cursorRequest = transaction.objectStore(SNAPSHOT_STORE).index('by-user').openCursor(userId)
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) return
        cursor.delete()
        cursor.continue()
      }
      await transactionDone(transaction)
      return { ok: true, epoch }
    } catch {
      return { ok: false, epoch }
    } finally {
      purgingUsers.delete(userId)
    }
  }

  // Mantém a API pública booleana; os chamadores internos usam a época para
  // não limpar o marcador de uma purga mais nova iniciada em outra aba.
  const purgeUser = async (userId) => (await purgeUserWithEpoch(userId)).ok

  const setEnabled = async (userId, enabled) => {
    if (!userId) return false
    if (enabled && !indexedDBImpl) return false
    const values = readMap(storage, PREFERENCE_KEY)
    values[userId] = Boolean(enabled)
    if (!writeMap(storage, PREFERENCE_KEY, values)) return false
    if (!enabled) await purgeUser(userId)
    else if (purgePending(userId)) {
      const purge = await purgeUserWithEpoch(userId)
      if (!purge.ok) {
        values[userId] = false
        writeMap(storage, PREFERENCE_KEY, values)
        return false
      }
      clearPurge(userId, purge.epoch)
    }
    return true
  }

  const readSnapshots = async (userId, resources = OFFLINE_RESOURCES) => {
    if (!userId || purgingUsers.has(userId) || !preferenceEnabled(userId)) return { data: null, fetchedAt: null, error: null }
    if (purgePending(userId)) {
      const purge = await purgeUserWithEpoch(userId)
      if (!purge.ok) return { data: null, fetchedAt: null, error: 'purge' }
      clearPurge(userId, purge.epoch)
    }
    try {
      const db = await open()
      const transaction = db.transaction(SNAPSHOT_STORE, 'readonly')
      const records = await requestResult(transaction.objectStore(SNAPSHOT_STORE).index('by-user').getAll(userId))
      await transactionDone(transaction)
      const allowed = new Set(resources.filter((resource) => OFFLINE_RESOURCES.includes(resource)))
      const valid = records.filter((record) => allowed.has(record.resource) && validateSnapshotRecord(record, userId))
      if (!valid.length) return { data: null, fetchedAt: null, error: null }
      return {
        data: Object.fromEntries(valid.map((record) => [record.resource, record.value])),
        fetchedAt: Math.max(...valid.map((record) => record.fetchedAt)),
        error: null,
      }
    } catch (error) {
      return { data: null, fetchedAt: null, error: errorCode(error) }
    }
  }

  const writeSnapshots = async (userId, values, fetchedAt = Date.now()) => {
    if (!userId || purgingUsers.has(userId) || !preferenceEnabled(userId) || purgePending(userId) || !plainObject(values)) {
      return { ok: false, error: null }
    }
    const capturedPurgeEpoch = purgeEpoch(userId)
    const records = Object.entries(values)
      .filter(([resource, value]) => validateOfflineValue(resource, value))
      .map(([resource, value]) => ({ userId, resource, value, fetchedAt, schemaVersion: 1 }))
    if (!records.length) return { ok: false, error: 'invalid' }
    try {
      const db = await open()
      if (purgingUsers.has(userId) || purgePending(userId) || purgeEpoch(userId) !== capturedPurgeEpoch) return { ok: false, error: null }
      const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite')
      for (const record of records) transaction.objectStore(SNAPSHOT_STORE).put(record)
      await transactionDone(transaction)
      return { ok: true, error: null }
    } catch (error) {
      return { ok: false, error: errorCode(error) }
    }
  }

  return { preferenceEnabled, setEnabled, readSnapshots, writeSnapshots, purgeUser }
}

export const offlineDb = createOfflineDb()
