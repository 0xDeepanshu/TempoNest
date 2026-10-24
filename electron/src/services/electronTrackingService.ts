import type { DesktopTrackingService } from '@/services/contracts'
import type { AppBridge } from '@/types/electron'

function getBridge(): AppBridge {
  if (!window.temponest) {
    throw new Error('The TempoNest desktop bridge is unavailable. Start the Electron app.')
  }
  return window.temponest
}

export const electronTrackingService: DesktopTrackingService = {
  restore: () => getBridge().tracking.restore(),
  start: (sessionId, startedAt) => getBridge().tracking.start(sessionId, startedAt),
  startBreak: (sessionId, breakId, startedAt) =>
    getBridge().tracking.startBreak(sessionId, breakId, startedAt),
  endBreak: (sessionId, breakId, endedAt) =>
    getBridge().tracking.endBreak(sessionId, breakId, endedAt),
  stop: (sessionId, endedAt) => getBridge().tracking.stop(sessionId, endedAt),
  refreshCurrent: () => getBridge().tracking.refreshCurrent(),
  getStatus: () => getBridge().tracking.getStatus(),
  onStateChanged: (listener) => {
    if (!window.temponest) return () => undefined
    return window.temponest.tracking.onStateChanged(listener)
  },
  onStatusChanged: (listener) => {
    if (!window.temponest) return () => undefined
    return window.temponest.tracking.onStatusChanged(listener)
  }
}
