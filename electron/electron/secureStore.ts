import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SecureStorageError } from './errors'

interface EncryptedFile {
  version: 1
  values: Record<string, string>
}

/**
 * Encrypts each stored value with Electron safeStorage before writing it to
 * disk. The renderer never receives this path or the values.
 */
export class SecureStore {
  private values: Record<string, string> = {}

  constructor(private readonly filePath: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<EncryptedFile>
      if (parsed.version !== 1 || typeof parsed.values !== 'object' || parsed.values === null) {
        return
      }
      this.values = Object.fromEntries(
        Object.entries(parsed.values).filter((entry): entry is [string, string] => {
          return typeof entry[1] === 'string'
        })
      )
    } catch {
      this.values = {}
    }
  }

  private assertAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new SecureStorageError(
        'Secure operating-system credential storage is unavailable. Sign-in cannot be persisted on this device.'
      )
    }
  }

  get(key: string): string | null {
    const encoded = this.values[key]
    if (!encoded) return null

    try {
      this.assertAvailable()
      const decrypted = safeStorage.decryptString(Buffer.from(encoded, 'base64'))
      return decrypted.length > 0 ? decrypted : null
    } catch (error) {
      if (error instanceof SecureStorageError) throw error
      delete this.values[key]
      this.persist()
      return null
    }
  }

  set(key: string, value: string): void {
    this.assertAvailable()
    this.values[key] = safeStorage.encryptString(value).toString('base64')
    this.persist()
  }

  remove(key: string): void {
    if (!(key in this.values)) return
    delete this.values[key]
    this.persist()
  }

  clear(): void {
    this.values = {}
    this.persist()
  }

  getJson<T>(key: string): T | null {
    const value = this.get(key)
    if (!value) return null
    try {
      return JSON.parse(value) as T
    } catch {
      this.remove(key)
      return null
    }
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value))
  }

  private persist(): void {
    const directory = dirname(this.filePath)
    mkdirSync(directory, { recursive: true })

    const payload: EncryptedFile = {
      version: 1,
      values: this.values
    }
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}
