import { electronActivityService } from '@/services/electronActivityService'
import { electronAuthService } from '@/services/electronAuthService'
import { electronTrackingService } from '@/services/electronTrackingService'

/**
 * Production composition point. Network calls and credentials stay in the
 * Electron main process; these adapters call the allowlisted preload bridge.
 */
export const authService = electronAuthService
export const trackingService = electronTrackingService
export const activityService = electronActivityService
export const authMode = 'backend' as const
