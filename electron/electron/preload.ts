import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActivityBridge,
  ActivityTrackingStatus,
  AppBridge,
  AppInfo,
  AuthBridge,
  MonitoringBridge,
  MonitoringStatus,
  TrackingBridge,
  TrackingOperationResult,
  TrackingRuntimeStatus,
  TrackingSnapshot,
  UserFacingError
} from '../src/types/electron'
import type { AuthSession, SignInCredentials } from '../src/types/auth'

type IpcEnvelope<T> = { ok: true; value: T } | { ok: false; error: UserFacingError }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcEnvelope<T>
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new Error('The desktop service returned an invalid response.')
  }
  if (!result.ok) {
    const error = new Error(result.error.message)
    error.name = result.error.code
    throw error
  }
  return result.value
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const auth: AuthBridge = {
  restoreSession: () => invoke<AuthSession | null>('auth:restore'),
  signIn: (credentials: SignInCredentials) => invoke<AuthSession>('auth:signIn', credentials),
  signOut: () => invoke<void>('auth:signOut'),
  onSessionChanged: (listener) => subscribe('auth:sessionChanged', listener)
}

const tracking: TrackingBridge = {
  restore: () => invoke<TrackingSnapshot | null>('tracking:restore'),
  start: (sessionId, startedAt) =>
    invoke<TrackingOperationResult>('tracking:start', sessionId, startedAt),
  startBreak: (sessionId, breakId, startedAt) =>
    invoke<TrackingOperationResult>('tracking:startBreak', sessionId, breakId, startedAt),
  endBreak: (sessionId, breakId, endedAt) =>
    invoke<TrackingOperationResult>('tracking:endBreak', sessionId, breakId, endedAt),
  stop: (sessionId, endedAt) =>
    invoke<TrackingOperationResult>('tracking:stop', sessionId, endedAt),
  refreshCurrent: () => invoke<TrackingSnapshot | null>('tracking:refreshCurrent'),
  getStatus: () => invoke<TrackingRuntimeStatus>('tracking:status'),
  onStateChanged: (listener) => subscribe('tracking:stateChanged', listener),
  onStatusChanged: (listener) => subscribe('tracking:statusChanged', listener)
}

const monitoring: MonitoringBridge = {
  getStatus: () => invoke<MonitoringStatus>('monitoring:status'),
  onStatusChanged: (listener) => subscribe('monitoring:statusChanged', listener)
}

const activity: ActivityBridge = {
  getStatus: () => invoke<ActivityTrackingStatus>('activity:status'),
  onStatusChanged: (listener) => subscribe('activity:statusChanged', listener)
}

const bridge: AppBridge = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  auth,
  tracking,
  monitoring,
  activity
}

contextBridge.exposeInMainWorld('temponest', bridge)
