/**
 * Screenshot failures are mapped to stable, user-safe codes before they cross
 * the main-process boundary. Raw capture/upload errors never reach the
 * renderer, and no credential or storage detail is attached to this error.
 */
export class ScreenshotOperationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ScreenshotOperationError'
    this.code = code
  }
}
