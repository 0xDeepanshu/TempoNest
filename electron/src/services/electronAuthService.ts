import type { AuthService } from '@/services/contracts'
import type { AppBridge } from '@/types/electron'
import type { AuthSession, SignInCredentials } from '@/types/auth'

function getBridge(): AppBridge {
  if (!window.temponest) {
    throw new Error('The TempoNest desktop bridge is unavailable. Start the Electron app.')
  }
  return window.temponest
}

export const electronAuthService: AuthService = {
  restoreSession: () => getBridge().auth.restoreSession(),
  signIn: (credentials: SignInCredentials) => getBridge().auth.signIn(credentials),
  signOut: () => getBridge().auth.signOut(),
  onSessionChanged: (listener: (session: AuthSession | null) => void) => {
    if (!window.temponest) return () => undefined
    return window.temponest.auth.onSessionChanged(listener)
  }
}
