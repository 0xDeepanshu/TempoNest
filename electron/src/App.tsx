import { useEffect } from 'react'
import { BRANDING } from '@shared/branding'
import { useAuth } from '@/auth/AuthProvider'
import { BrandedSplash } from '@/components/BrandedSplash'
import { LoginScreen } from '@/screens/LoginScreen'
import { TrackerScreen } from '@/screens/TrackerScreen'
import { useTimer } from '@/tracking/TimerProvider'

export default function App() {
  const { status, session } = useAuth()
  const { ready } = useTimer()

  useEffect(() => {
    document.title =
      status === 'unauthenticated' ? `Sign in · ${BRANDING.name}` : BRANDING.name
  }, [status])

  if (status === 'loading') {
    return <BrandedSplash />
  }

  if (status === 'unauthenticated' || !session) {
    return <LoginScreen />
  }

  // Never show a cached running timer before the launch snapshot has been
  // reconciled with the backend.
  if (!ready) {
    return <BrandedSplash />
  }

  return <TrackerScreen />
}
