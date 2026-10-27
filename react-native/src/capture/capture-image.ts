import type { CameraCapturedPicture } from 'expo-camera';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type { LocalImage } from '../api/attendance';

/**
 * Normalizes a camera capture into the raw image that the evidence upload
 * accepts. On web, the camera returns a base64 data URI rather than a file.
 */
export function toLocalImage(picture: CameraCapturedPicture): LocalImage {
  const contentType = picture.format === 'png' ? 'image/png' : 'image/jpeg';
  let uri = picture.uri;
  let base64 = picture.base64 ?? null;

  if (
    Platform.OS === 'web' &&
    !uri.startsWith('data:') &&
    !uri.startsWith('blob:') &&
    !uri.startsWith('http')
  ) {
    base64 = base64 ?? uri;
    uri = `data:${contentType};base64,${base64}`;
  }

  let sizeBytes = 0;
  if (Platform.OS === 'web') {
    if (base64) sizeBytes = Math.floor((base64.length * 3) / 4);
  } else {
    try {
      const file = new File(uri);
      sizeBytes = file.exists ? file.size : 0;
    } catch {
      sizeBytes = 0;
    }
  }

  return {
    uri,
    contentType,
    sizeBytes,
    base64,
    capturedAt: new Date().toISOString(),
  };
}
