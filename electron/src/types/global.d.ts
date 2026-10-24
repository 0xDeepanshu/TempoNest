import type { AppBridge } from './electron'

declare global {
  interface Window {
    /** Injected by electron/preload.ts. Undefined when running in a browser. */
    temponest?: AppBridge
  }
}

export {}
