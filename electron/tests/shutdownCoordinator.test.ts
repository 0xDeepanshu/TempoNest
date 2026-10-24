import { describe, expect, it, vi } from 'vitest'
import { ShutdownCoordinator } from '../electron/shutdownCoordinator'

describe('ShutdownCoordinator', () => {
  it('runs cleanup once when quit paths overlap', async () => {
    const cleanup = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    const coordinator = new ShutdownCoordinator(cleanup)

    await Promise.all([coordinator.run(), coordinator.run(), coordinator.run()])

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('never blocks quitting when cleanup fails', async () => {
    const coordinator = new ShutdownCoordinator(async () => {
      throw new Error('cleanup failed')
    })

    await expect(coordinator.run()).resolves.toBeUndefined()
  })

  it('gives up waiting after the timeout', async () => {
    const coordinator = new ShutdownCoordinator(() => new Promise<void>(() => undefined), 20)

    await expect(coordinator.run()).resolves.toBeUndefined()
  })
})
