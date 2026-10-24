function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable or full. The in-memory UI remains usable.
  }
}

export function readStoredJson<T>(key: string): T | null {
  return readJson<T>(window.localStorage, key)
}

export function writeStoredJson(key: string, value: unknown): void {
  writeJson(window.localStorage, key, value)
}

export function readSessionJson<T>(key: string): T | null {
  return readJson<T>(window.sessionStorage, key)
}

export function writeSessionJson(key: string, value: unknown): void {
  writeJson(window.sessionStorage, key, value)
}

export function removeSessionItem(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // Ignore storage failures; sign-out still clears in-memory state.
  }
}
