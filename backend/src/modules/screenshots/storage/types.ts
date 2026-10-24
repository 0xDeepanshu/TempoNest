import type { Readable } from 'node:stream';

export type UploadTarget = {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
  /** True when the URL is served by this API and needs agent/auth headers. */
  requiresApiAuth: boolean;
};

export type StoredObjectInfo = {
  sizeBytes: number;
  contentType: string | null;
};

export type DownloadUrl = {
  url: string;
  expiresAt: Date;
};

export interface ScreenshotStorage {
  readonly driver: 'local' | 's3';
  createUploadTarget(input: {
    objectKey: string;
    contentType: string;
    expiresAt: Date;
    uploadToken: string;
  }): Promise<UploadTarget>;
  putObject(input: { objectKey: string; body: Buffer; contentType: string }): Promise<StoredObjectInfo>;
  statObject(objectKey: string): Promise<StoredObjectInfo | null>;
  readPrefix(objectKey: string, length: number): Promise<Buffer>;
  deleteObject(objectKey: string): Promise<void>;
  createDownloadUrl(input: {
    screenshotId: string;
    organizationId: string;
    actorUserId: string | null;
    objectKey: string;
    expiresAt: Date;
  }): Promise<DownloadUrl>;
  openObject(objectKey: string): Promise<{ stream: Readable; sizeBytes: number } | null>;
}
