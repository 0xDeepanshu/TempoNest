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

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ScreenshotOperationError(
      'REQUEST_CANCELLED',
      'The screenshot request was cancelled before capture completed.'
    )
  }
}

function scaledSize(primary: Electron.Display): { width: number; height: number } {
  const factor = primary.scaleFactor > 0 ? primary.scaleFactor : 1
  let width = Math.max(1, Math.round(primary.size.width * factor))
  let height = Math.max(1, Math.round(primary.size.height * factor))
  const longest = Math.max(width, height)
  if (longest > MAX_DIMENSION) {
    const ratio = MAX_DIMENSION / longest
    width = Math.max(1, Math.round(width * ratio))
    height = Math.max(1, Math.round(height * ratio))
  }
  return { width, height }
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
  assertNotAborted(options.signal)

  if (process.platform === 'darwin') {
    const permission = systemPreferences.getMediaAccessStatus('screen')
    if (permission === 'denied' || permission === 'restricted') {
      throw new ScreenshotOperationError(
        'OS_PERMISSION_DENIED',
        'Screen Recording permission is not granted in macOS System Settings, so no screenshot was captured.'
      )
    }
  }

  const primary = screen.getPrimaryDisplay()
  const { width, height } = scaledSize(primary)

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

  assertNotAborted(options.signal)

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
  if (longest > MAX_DIMENSION) {
    const ratio = MAX_DIMENSION / longest
    image = image.resize({
      width: Math.max(1, Math.round(actual.width * ratio)),
      height: Math.max(1, Math.round(actual.height * ratio)),
      quality: 'best'
    })
  }

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
