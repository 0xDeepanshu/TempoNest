import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { authService } from '@/services'
import type { AuthSession, SignInCredentials } from '@/types/auth'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  status: AuthStatus
  session: AuthSession | null
  signIn: (credentials: SignInCredentials) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<AuthSession | null>(null)

  useEffect(() => {
    let mounted = true

    const unsubscribe = authService.onSessionChanged?.((nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setStatus(nextSession ? 'authenticated' : 'unauthenticated')
    })

    authService
      .restoreSession()
      .then((restored) => {
        if (!mounted) return
        setSession(restored)
        setStatus(restored ? 'authenticated' : 'unauthenticated')
      })
      .catch(() => {
        if (!mounted) return
        setSession(null)
        setStatus('unauthenticated')
      })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  const signIn = useCallback(async (credentials: SignInCredentials) => {
    const nextSession = await authService.signIn(credentials)
    setSession(nextSession)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(async () => {
    try {
      await authService.signOut()
    } finally {
      setSession(null)
      setStatus('unauthenticated')
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, signIn, signOut }),
    [session, signIn, signOut, status]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }

  return context
}
