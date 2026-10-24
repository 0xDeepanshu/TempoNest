import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider } from '@/auth/AuthProvider'
import { TimerProvider } from '@/tracking/TimerProvider'
import './index.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root was not found')
}

createRoot(container).render(
  <StrictMode>
    <TimerProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </TimerProvider>
  </StrictMode>
)
