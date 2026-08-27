// =====================================================================
// AuthContext - fachada publica para sessao, login e MFA (TOTP)
// =====================================================================

import { createContext, useContext, useMemo } from 'react'
import { isSupabaseConfigured, configurationProblem } from '../lib/supabase.js'
import { useAuthSession } from './authSession.js'
import { useAuthOperations, validatePassword } from './authOperations.js'

const AuthContext = createContext(null)

export { validatePassword }

export function AuthProvider({ children }) {
  const { session, user, loading, mfaStage, assuranceLevel, refreshAssurance, signOut } = useAuthSession()
  const operations = useAuthOperations({ refreshAssurance })
  const missingConfig = configurationProblem()

  const value = useMemo(() => ({
    session,
    user,
    loading,
    mfaStage,
    assuranceLevel,
    isConfigured: isSupabaseConfigured,
    configurationProblem: missingConfig,
    ...operations,
    signOut,
  }), [session, user, loading, mfaStage, assuranceLevel, missingConfig, operations, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return ctx
}
