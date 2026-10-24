const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000

/**
 * Runs the quit cleanup exactly once. Electron emits `before-quit` again after
 * a prevented quit, and window-close paths can overlap with an explicit quit,
 * so concurrent callers must share one promise. A timeout keeps a broken
 * network from leaving an invisible, unquittable process behind; the durable
 * offline queue already holds any stop that could not be delivered in time.
 */
export class ShutdownCoordinator {
  private promise: Promise<void> | null = null

  constructor(
    private readonly cleanup: () => Promise<void>,
    private readonly timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS
  ) {}

  run(): Promise<void> {
    if (!this.promise) {
      this.promise = this.execute()
    }
    return this.promise
  }

  private async execute(): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        this.cleanup(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.timeoutMs)
        })
      ])
    } catch {
      // Cleanup is best effort; quitting must never be blocked by a failure.
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
