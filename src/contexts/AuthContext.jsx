import { createContext, useContext, useMemo } from 'react'
import { isSupabaseConfigured, configurationProblem } from '../lib/supabase.js'
import { useAuthSession } from './authSession.js'
import { useAuthOperations, validatePassword } from './authOperations.js'

const AuthContext = createContext(null)

export { validatePassword }

export function AuthProvider({ children }) {
  const {
    session, user, loading, mfaStage, assuranceLevel, sessionRevision,
    offlineCacheEnabled, refreshAssurance, requestSessionRefresh,
    scheduleSessionRetry, clearSessionRetry, setOfflineCache, signOut,
  } = useAuthSession()
  const operations = useAuthOperations({ refreshAssurance })
  const missingConfig = configurationProblem()

  const value = useMemo(() => ({
    session,
    user,
    loading,
    mfaStage,
    assuranceLevel,
    sessionRevision,
    offlineCacheEnabled,
    requestSessionRefresh,
    scheduleSessionRetry,
    clearSessionRetry,
    setOfflineCache,
    isConfigured: isSupabaseConfigured,
    configurationProblem: missingConfig,
    ...operations,
    signOut,
  }), [session, user, loading, mfaStage, assuranceLevel, sessionRevision, offlineCacheEnabled,
    requestSessionRefresh, scheduleSessionRetry, clearSessionRetry, setOfflineCache,
    missingConfig, operations, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return ctx
}
