import { powerMonitor } from 'electron'

/**
 * Thin wrapper around Electron's OS idle and power signals. The collector uses
 * only these numeric/event signals, never keyboard or pointer content.
 */
export interface SystemActivitySignals {
  getSystemIdleSeconds(): number
  onSuspend(listener: () => void): () => void
  onResume(listener: () => void): () => void
}

export function createSystemActivitySignals(): SystemActivitySignals {
  return {
    getSystemIdleSeconds() {
      try {
        const seconds = powerMonitor.getSystemIdleTime()
        return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0
      } catch {
        return 0
      }
    },
    onSuspend(listener) {
      powerMonitor.on('suspend', listener)
      return () => powerMonitor.removeListener('suspend', listener)
    },
    onResume(listener) {
      powerMonitor.on('resume', listener)
      return () => powerMonitor.removeListener('resume', listener)
    }
  }
}