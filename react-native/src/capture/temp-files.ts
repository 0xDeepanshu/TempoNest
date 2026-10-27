import { File } from 'expo-file-system';
import { Platform } from 'react-native';

/** Removes a camera cache file. Never worth failing the flow over. */
export function deleteLocalCapture(uri: string | null | undefined): void {
  if (!uri || Platform.OS === 'web' || uri.startsWith('data:')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The OS cache will reclaim it.
  }
}
