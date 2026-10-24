import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../../config/env';
import { AppError } from '../../../utils/errors';
import type {
  DownloadUrl,
  ScreenshotStorage,
  StoredObjectInfo,
  UploadTarget,
} from './types';

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate?.name === 'NoSuchKey' ||
    candidate?.name === 'NotFound' ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}

/**
 * Private S3-compatible storage adapter. The bucket must not be public. Uploads
 * and downloads use short-lived presigned URLs; completion metadata is checked
 * with HeadObject by the authenticated agent completion service.
 */
export class S3ScreenshotStorage implements ScreenshotStorage {
  readonly driver = 's3' as const;
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    const s3 = config.screenshots.s3;
    if (!s3.bucket) {
      throw new Error('SCREENSHOT_S3_BUCKET is required for the S3 screenshot storage adapter');
    }
    this.bucket = s3.bucket;
    this.client = new S3Client({
      region: s3.region,
      ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
      forcePathStyle: s3.forcePathStyle,
      ...(s3.accessKeyId && s3.secretAccessKey
        ? {
            credentials: {
              accessKeyId: s3.accessKeyId,
              secretAccessKey: s3.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async createUploadTarget(input: {
    objectKey: string;
    contentType: string;
    expiresAt: Date;
    uploadToken: string;
  }): Promise<UploadTarget> {
    void input.uploadToken;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
    });
    const expiresIn = Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000));
    const url = await getSignedUrl(this.client, command, {
      expiresIn: Math.min(expiresIn, 3600),
    });
    return {
      method: 'PUT',
      url,
      headers: { 'Content-Type': input.contentType },
      expiresAt: input.expiresAt,
      requiresApiAuth: false,
    };
  }

  async putObject(input: {
    objectKey: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObjectInfo> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { sizeBytes: input.body.length, contentType: input.contentType };
  }

  async statObject(objectKey: string): Promise<StoredObjectInfo | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return {
        sizeBytes: Number(response.ContentLength ?? 0),
        contentType: response.ContentType ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readPrefix(objectKey: string, length: number): Promise<Buffer> {
    const safeLength = Math.max(0, length);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Range: `bytes=0-${Math.max(0, safeLength - 1)}`,
      }),
    );
    const body = response.Body as
      | { transformToByteArray?: () => Promise<Uint8Array> }
      | undefined;
    if (!body?.transformToByteArray) {
      throw AppError.internal('Unable to read uploaded screenshot', 'SCREENSHOT_STORAGE_ERROR');
    }
    return Buffer.from(await body.transformToByteArray());
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async createDownloadUrl(input: {
    screenshotId: string;
    organizationId: string;
    actorUserId: string | null;
    objectKey: string;
    expiresAt: Date;
  }): Promise<DownloadUrl> {
    void input.screenshotId;
    void input.organizationId;
    void input.actorUserId;
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey });
    const expiresIn = Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000));
    const url = await getSignedUrl(this.client, command, {
      expiresIn: Math.min(expiresIn, 3600),
    });
    return { url, expiresAt: input.expiresAt };
  }

  async openObject(_objectKey: string): Promise<{ stream: Readable; sizeBytes: number } | null> {
    return null;
  }
}
