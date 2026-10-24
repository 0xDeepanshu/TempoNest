import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { config } from '../../../config/env';
import { AppError } from '../../../utils/errors';
import { createScreenshotDownloadToken } from '../screenshot.tokens';
import type {
  DownloadUrl,
  ScreenshotStorage,
  StoredObjectInfo,
  UploadTarget,
} from './types';

/**
 * Development/small-deployment adapter. Files are private on disk and are only
 * served through signed, short-lived API URLs. Object keys are always generated
 * by the server, but we still resolve them defensively against traversal.
 */
export class LocalScreenshotStorage implements ScreenshotStorage {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root = config.screenshots.localDir) {
    this.root = path.resolve(root);
  }

  private resolveObjectPath(objectKey: string): string {
    if (!objectKey || objectKey.includes('\\') || objectKey.includes('\0')) {
      throw AppError.badRequest('Invalid screenshot object key', 'INVALID_STORAGE_KEY');
    }
    const resolved = path.resolve(this.root, objectKey);
    const rootPrefix = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
    if (!resolved.startsWith(rootPrefix)) {
      throw AppError.badRequest('Invalid screenshot object key', 'INVALID_STORAGE_KEY');
    }
    return resolved;
  }

  async createUploadTarget(input: {
    objectKey: string;
    contentType: string;
    expiresAt: Date;
    uploadToken: string;
    uploadPath?: string;
  }): Promise<UploadTarget> {
    void input.objectKey;
    const pathPrefix = input.uploadPath ?? '/agent/screenshot-uploads';
    return {
      method: 'PUT',
      url: `${config.screenshots.publicBaseUrl}${config.apiPrefix}${pathPrefix}/${encodeURIComponent(input.uploadToken)}`,
      headers: {
        'Content-Type': input.contentType,
      },
      expiresAt: input.expiresAt,
      requiresApiAuth: true,
    };
  }

  async putObject(input: {
    objectKey: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObjectInfo> {
    void input.contentType;
    const objectPath = this.resolveObjectPath(input.objectKey);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });

    const temporaryPath = `${objectPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, input.body, { mode: 0o600 });
      await fs.rename(temporaryPath, objectPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return { sizeBytes: input.body.length, contentType: null };
  }

  async statObject(objectKey: string): Promise<StoredObjectInfo | null> {
    try {
      const stat = await fs.stat(this.resolveObjectPath(objectKey));
      if (!stat.isFile()) return null;
      return { sizeBytes: stat.size, contentType: null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async readPrefix(objectKey: string, length: number): Promise<Buffer> {
    const handle = await fs.open(this.resolveObjectPath(objectKey), 'r');
    try {
      const buffer = Buffer.alloc(Math.max(0, length));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    await fs.rm(this.resolveObjectPath(objectKey), { force: true });
  }

  async createDownloadUrl(input: {
    screenshotId: string;
    organizationId: string;
    actorUserId: string | null;
    objectKey: string;
    expiresAt: Date;
    downloadToken?: string;
    downloadPath?: string;
  }): Promise<DownloadUrl> {
    void input.objectKey;
    const token = input.downloadToken ?? createScreenshotDownloadToken(input);
    const pathPrefix = input.downloadPath ?? '/screenshot-files';
    return {
      url: `${config.screenshots.publicBaseUrl}${config.apiPrefix}${pathPrefix}/${encodeURIComponent(token)}`,
      expiresAt: input.expiresAt,
    };
  }

  async openObject(objectKey: string): Promise<{ stream: Readable; sizeBytes: number } | null> {
    const info = await this.statObject(objectKey);
    if (!info) return null;
    return {
      stream: createReadStream(this.resolveObjectPath(objectKey)),
      sizeBytes: info.sizeBytes,
    };
  }
}

/** Test/maintenance helper: remove every file owned by the local adapter. */
export async function clearLocalScreenshotStorage(): Promise<void> {
  await fs.rm(config.screenshots.localDir, { recursive: true, force: true });
}
