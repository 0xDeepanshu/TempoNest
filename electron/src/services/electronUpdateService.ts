import type { DesktopUpdateService } from '@/services/contracts'
import type { AppBridge } from '@/types/electron'

function getBridge(): AppBridge {
  if (!window.temponest) {
    throw new Error('The WorkZen desktop bridge is unavailable. Start the Electron app.')
  }
  return window.temponest
}

export const electronUpdateService: DesktopUpdateService = {
  getStatus: () => getBridge().updates.getStatus(),
  check: () => getBridge().updates.check(),
  download: () => getBridge().updates.download(),
  install: () => getBridge().updates.install(),
  onStatusChanged: (listener) => {
    if (!window.temponest) return () => undefined
    return window.temponest.updates.onStatusChanged(listener)
  }
}
