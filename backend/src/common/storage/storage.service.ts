import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { Env } from '../../config/env';

export interface StoredObject {
  url: string;
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface UploadOptions {
  /** Logical folder, e.g. `vehicles` or `inspections`. */
  folder: string;
  buffer: Buffer;
  contentType: string;
  originalName?: string;
}

/** Image types accepted for vehicle and inspection photos. */
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

/** Document types accepted for vehicle paperwork. */
const DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/**
 * Object storage behind one interface, so callers never know whether a file
 * landed on local disk or in a bucket.
 *
 * Local is the development default. Production sets `STORAGE_DRIVER=s3`, and
 * because the return shape is identical nothing else in the codebase changes.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: 'local' | 's3';
  private readonly uploadDir: string;
  private readonly maxBytes: number;
  private readonly s3: S3Client | null = null;
  private readonly bucket: string | null = null;
  private readonly publicUrl: string | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.driver = this.config.get('STORAGE_DRIVER', { infer: true });
    this.uploadDir = resolve(this.config.get('UPLOAD_DIR', { infer: true }));
    this.maxBytes = this.config.get('MAX_UPLOAD_BYTES', { infer: true });

    if (this.driver === 's3') {
      const endpoint = this.config.get('S3_ENDPOINT', { infer: true });
      const options: S3ClientConfig = {
        region: this.config.get('S3_REGION', { infer: true }),
        forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE', { infer: true }),
        credentials: {
          accessKeyId: this.config.get('S3_ACCESS_KEY_ID', { infer: true }) ?? '',
          secretAccessKey: this.config.get('S3_SECRET_ACCESS_KEY', { infer: true }) ?? '',
        },
      };
      // Set only when provided, so the AWS SDK resolves the default endpoint
      // for real AWS while MinIO and other stores can point somewhere else.
      if (endpoint) options.endpoint = endpoint;

      this.s3 = new S3Client(options);
      this.bucket = this.config.get('S3_BUCKET', { infer: true }) ?? null;
      this.publicUrl = this.config.get('S3_PUBLIC_URL', { infer: true }) ?? null;
      this.logger.log(`Storage driver: s3 (bucket ${this.bucket})`);
    } else {
      mkdirSync(this.uploadDir, { recursive: true });
      this.logger.log(`Storage driver: local (${this.uploadDir})`);
    }
  }

  get maxUploadBytes(): number {
    return this.maxBytes;
  }

  /** Validates and stores an image, returning its public URL. */
  async uploadImage(options: UploadOptions): Promise<StoredObject> {
    return this.upload(options, IMAGE_TYPES, 'image');
  }

  /** Validates and stores a document, returning its public URL. */
  async uploadDocument(options: UploadOptions): Promise<StoredObject> {
    return this.upload(options, DOCUMENT_TYPES, 'document');
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.driver === 's3' && this.s3 && this.bucket) {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      } else {
        unlinkSync(join(this.uploadDir, key));
      }
    } catch (error) {
      // A missing object is not worth failing a delete over.
      this.logger.debug(`Failed to delete ${key}: ${String(error)}`);
    }
  }

  private async upload(
    options: UploadOptions,
    allowed: Record<string, string>,
    kind: string,
  ): Promise<StoredObject> {
    const extension = allowed[options.contentType];
    if (!extension) {
      throw new BadRequestException(
        `Unsupported ${kind} type "${options.contentType}". Allowed: ${Object.keys(allowed).join(', ')}`,
      );
    }

    if (options.buffer.byteLength > this.maxBytes) {
      throw new BadRequestException(
        `File is too large. Maximum size is ${Math.floor(this.maxBytes / 1024 / 1024)} MB`,
      );
    }

    // A generated name discards the client-supplied filename entirely, which
    // removes any path-traversal or extension-spoofing surface.
    const key = `${options.folder}/${randomUUID()}${extension}`;

    if (this.driver === 's3' && this.s3 && this.bucket) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: options.buffer,
          ContentType: options.contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      const base = this.publicUrl ?? `${this.config.get('S3_ENDPOINT', { infer: true })}/${this.bucket}`;
      return {
        url: `${base.replace(/\/$/, '')}/${key}`,
        key,
        sizeBytes: options.buffer.byteLength,
        contentType: options.contentType,
      };
    }

    const target = join(this.uploadDir, key);
    mkdirSync(join(this.uploadDir, options.folder), { recursive: true });
    writeFileSync(target, options.buffer);

    return {
      url: `/uploads/${key}`,
      key,
      sizeBytes: options.buffer.byteLength,
      contentType: options.contentType,
    };
  }
}
