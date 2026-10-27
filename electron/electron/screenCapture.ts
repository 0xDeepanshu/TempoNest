import { desktopCapturer, screen, systemPreferences } from 'electron'
import { ScreenshotOperationError } from './screenshotErrors'
import type {
  ScreenshotCapture,
  ScreenshotCaptureOptions,
  ScreenshotCaptureResult
} from './screenshotService'

/** Keep encoded images inside the server's upload limit without cropping. */
const MAX_DIMENSION = 2560
const JPEG_QUALITY = 82
const LIVE_JPEG_QUALITY = 70
const LIVE_FALLBACK_QUALITIES = [55, 40, 30]
const LIVE_DOWNSCALE_STEPS = 3
const LIVE_DOWNSCALE_FACTOR = 0.8

export interface LiveFrameCaptureOptions {
  signal: AbortSignal
  maxWidth: number
  maxBytes: number
}

export interface LiveFrameCaptureResult {
  bytes: Buffer
  capturedAt: string
  width: number
  height: number
}

export type LiveFrameCapture = (
  options: LiveFrameCaptureOptions
) => Promise<LiveFrameCaptureResult>

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ScreenshotOperationError(
      'REQUEST_CANCELLED',
      'The screen capture was cancelled before it completed.'
    )
  }
}

function scaledSize(
  primary: Electron.Display,
  maxDimension: number
): { width: number; height: number } {
  const factor = primary.scaleFactor > 0 ? primary.scaleFactor : 1
  let width = Math.max(1, Math.round(primary.size.width * factor))
  let height = Math.max(1, Math.round(primary.size.height * factor))
  const longest = Math.max(width, height)
  if (longest > maxDimension) {
    const ratio = maxDimension / longest
    width = Math.max(1, Math.round(width * ratio))
    height = Math.max(1, Math.round(height * ratio))
  }
  return { width, height }
}

function assertScreenPermission(): void {
  if (process.platform === 'darwin') {
    const permission = systemPreferences.getMediaAccessStatus('screen')
    if (permission === 'denied' || permission === 'restricted') {
      throw new ScreenshotOperationError(
        'OS_PERMISSION_DENIED',
        'Screen Recording permission is not granted in macOS System Settings, so no screen image was captured.'
      )
    }
  }
}

/**
 * Captures the primary display at a bounded dimension. Capture only happens
 * after the backend has authorized it; the renderer cannot invoke this
 * directly.
 */
async function capturePrimaryImage(
  maxDimension: number,
  signal: AbortSignal
): Promise<Electron.NativeImage> {
  assertNotAborted(signal)
  assertScreenPermission()

  const primary = screen.getPrimaryDisplay()
  const { width, height } = scaledSize(primary, maxDimension)

  let sources: Electron.DesktopCapturerSource[]
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false
    })
  } catch {
    throw new ScreenshotOperationError(
      'CAPTURE_UNAVAILABLE',
      'The operating system did not allow the screen to be captured.'
    )
  }

  assertNotAborted(signal)

  const source =
    sources.find((candidate) => candidate.display_id === String(primary.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new ScreenshotOperationError(
      'CAPTURE_UNAVAILABLE',
      'No display was available to capture.'
    )
  }

  let image = source.thumbnail
  const actual = image.getSize()
  const longest = Math.max(actual.width, actual.height)
  if (longest > maxDimension) {
    const ratio = maxDimension / longest
    image = image.resize({
      width: Math.max(1, Math.round(actual.width * ratio)),
      height: Math.max(1, Math.round(actual.height * ratio)),
      quality: 'best'
    })
  }
  return image
}

/**
 * Captures the primary display inside the Electron main process.
 *
 * This is called only after the backend has acknowledged an explicit claim for
 * this employee and device. There is no timer, no trigger when tracking starts,
 * and no way for the renderer to invoke it directly.
 */
export const capturePrimaryScreen: ScreenshotCapture = async (
  options: ScreenshotCaptureOptions
): Promise<ScreenshotCaptureResult> => {
  const image = await capturePrimaryImage(MAX_DIMENSION, options.signal)
  assertNotAborted(options.signal)

  const bytes = image.toJPEG(JPEG_QUALITY)
  if (bytes.length === 0) {
    throw new ScreenshotOperationError(
      'CAPTURE_EMPTY',
      'The screen capture was empty, so nothing was uploaded.'
    )
  }
  if (bytes.length > options.maxBytes) {
    throw new ScreenshotOperationError(
      'CAPTURE_TOO_LARGE',
      'The screen capture was larger than the organization upload limit.'
    )
  }

  const finalSize = image.getSize()
  return {
    bytes,
    contentType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    width: finalSize.width,
    height: finalSize.height
  }
}

/**
 * Captures one frame for an authorized live-screen session. The encoded frame
 * must stay within the backend's payload limit; quality is reduced before the
 * frame is downscaled so the stream keeps working on dense displays.
 */
export const captureLiveFrame: LiveFrameCapture = async (
  options: LiveFrameCaptureOptions
): Promise<LiveFrameCaptureResult> => {
  const maxWidth = Math.max(320, Math.min(3840, Math.round(options.maxWidth)))
  let image = await capturePrimaryImage(maxWidth, options.signal)
  assertNotAborted(options.signal)

  const qualities = [LIVE_JPEG_QUALITY, ...LIVE_FALLBACK_QUALITIES]
  for (const quality of qualities) {
    const bytes = image.toJPEG(quality)
    if (bytes.length === 0) {
      throw new ScreenshotOperationError(
        'CAPTURE_EMPTY',
        'The live screen frame was empty, so capture stopped.'
      )
    }
    if (bytes.length <= options.maxBytes) {
      const size = image.getSize()
      return {
        bytes,
        capturedAt: new Date().toISOString(),
        width: size.width,
        height: size.height
      }
    }
  }

  for (let step = 0; step < LIVE_DOWNSCALE_STEPS; step += 1) {
    assertNotAborted(options.signal)
    const current = image.getSize()
    image = image.resize({
      width: Math.max(1, Math.round(current.width * LIVE_DOWNSCALE_FACTOR)),
      height: Math.max(1, Math.round(current.height * LIVE_DOWNSCALE_FACTOR)),
      quality: 'good'
    })
    const bytes = image.toJPEG(LIVE_FALLBACK_QUALITIES.at(-1) ?? 30)
    if (bytes.length > 0 && bytes.length <= options.maxBytes) {
      const size = image.getSize()
      return {
        bytes,
        capturedAt: new Date().toISOString(),
        width: size.width,
        height: size.height
      }
    }
  }

  throw new ScreenshotOperationError(
    'CAPTURE_TOO_LARGE',
    'The live screen frame exceeded the server payload limit, so capture stopped.'
  )
}
