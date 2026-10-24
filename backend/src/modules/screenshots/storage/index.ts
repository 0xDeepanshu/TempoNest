import { config } from '../../../config/env';
import { LocalScreenshotStorage } from './localStorage';
import { S3ScreenshotStorage } from './s3Storage';
import type { ScreenshotStorage } from './types';

function createStorage(): ScreenshotStorage {
  if (config.screenshots.driver === 's3') return new S3ScreenshotStorage();
  return new LocalScreenshotStorage();
}

export const screenshotStorage: ScreenshotStorage = createStorage();

export type { ScreenshotStorage, UploadTarget, StoredObjectInfo, DownloadUrl } from './types';
