import type { DesktopActivityService } from '@/services/contracts'
import type { AppBridge } from '@/types/electron'

function getBridge(): AppBridge {
  if (!window.temponest) {
    throw new Error('The TempoNest desktop bridge is unavailable. Start the Electron app.')
  }
  return window.temponest
}

export const electronActivityService: DesktopActivityService = {
  getStatus: () => getBridge().activity.getStatus(),
  onStatusChanged: (listener) => {
    if (!window.temponest) return () => undefined
    return window.temponest.activity.onStatusChanged(listener)
  }
}