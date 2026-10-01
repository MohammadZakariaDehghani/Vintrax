import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  PROMO_VIDEO,
  type PromoVideoUploadSession,
  type PromoVideoUploadStatus,
  type PromoVideoUploadStatusValue,
  type PromoTileVideoUpload,
  type StartPromoVideoUploadInput,
} from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import {
  UnreadableVideoError,
  VideoProcessingUnavailableError,
  VideoProcessor,
} from '../../common/media/video-processor';
import { StorageService } from '../../common/storage/storage.service';

/** What a finished upload stored, for a target that records it somewhere. */
export interface StoredVideoUpload {
  result: PromoTileVideoUpload;
  /** The phone rendition, when the target asked for one and the video is wider. */
  smallUrl: string | null;
  /** Every file written, so whoever records them can delete them later. */
  keys: string[];
}

/**
 * Where an upload's files go and what happens once they are stored. Promo
 * tiles take the files' URLs straight into a form; the media library also
 * makes a phone rendition and records an asset, whose id the status reports.
 */
export interface VideoUploadTarget {
  folder: string;
  smallWidth?: number;
  /** Records the stored files and returns the new record's id. */
  register?: (stored: StoredVideoUpload) => Promise<string>;
}

const PROMO_TILE_TARGET: VideoUploadTarget = { folder: 'promo-tiles' };

/** An abandoned upload is deleted after this long without a new piece or a status check. */
export const UPLOAD_IDLE_MS = 60 * 60_000;
const SWEEP_EVERY_MS = 10 * 60_000;
/** Uploads in flight at once, per administrator and in total, so disk use has a ceiling. */
const MAX_OPEN_PER_USER = 3;
const MAX_OPEN_TOTAL = 12;

interface Session {
  id: string;
  ownerId: string;
  sizeBytes: number;
  contentType: string;
  chunkCount: number;
  nextIndex: number;
  receivedBytes: number;
  status: PromoVideoUploadStatusValue;
  result: PromoTileVideoUpload | null;
  error: string | null;
  dir: string;
  file: string;
  touchedAt: number;
  target: VideoUploadTarget;
  /** Set once a target with `register` has recorded the upload. */
  assetId: string | null;
}

/**
 * Promo tile videos, uploaded in pieces and optimised in the background.
 *
 * Why not one request: a phone clip is tens of megabytes, and a reverse proxy
 * in front of the API usually refuses a body that large (Nginx answered the
 * first real upload with an HTML 413). Pieces of `PROMO_VIDEO.chunkBytes` fit
 * under any sensible limit.
 *
 * Why in the background: re-encoding takes longer than a proxy waits for an
 * answer. The browser asks for the status instead of holding a request open.
 *
 * The pieces are appended, in order, to one temporary file; it is deleted once
 * processed, failed, or abandoned. Only the optimised video and its poster are
 * ever stored. Sessions live in this process — the API runs as one instance.
 */
@Injectable()
export class PromoVideoUploadsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromoVideoUploadsService.name);
  private readonly sessions = new Map<string, Session>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly videos: VideoProcessor,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.sweeper.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.all([...this.sessions.values()].map((session) => this.discard(session)));
  }

  async start(
    user: AuthUser,
    input: Pick<StartPromoVideoUploadInput, 'sizeBytes' | 'contentType'>,
    target: VideoUploadTarget = PROMO_TILE_TARGET,
  ): Promise<PromoVideoUploadSession> {
    const open = [...this.sessions.values()].filter(
      (session) => session.status === 'UPLOADING' || session.status === 'PROCESSING',
    );
    if (
      open.filter((session) => session.ownerId === user.id).length >= MAX_OPEN_PER_USER ||
      open.length >= MAX_OPEN_TOTAL
    ) {
      throw new ConflictException(
        'Too many video uploads are in progress. Wait for one to finish and try again.',
      );
    }

    const dir = await mkdtemp(join(tmpdir(), 'vintrax-promo-video-'));
    const file = join(dir, 'upload.bin');
    await writeFile(file, Buffer.alloc(0));

    const session: Session = {
      id: randomUUID(),
      ownerId: user.id,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      chunkCount: Math.ceil(input.sizeBytes / PROMO_VIDEO.chunkBytes),
      nextIndex: 0,
      receivedBytes: 0,
      status: 'UPLOADING',
      result: null,
      error: null,
      dir,
      file,
      touchedAt: Date.now(),
      target,
      assetId: null,
    };
    this.sessions.set(session.id, session);

    return {
      uploadId: session.id,
      chunkBytes: PROMO_VIDEO.chunkBytes,
      chunkCount: session.chunkCount,
    };
  }

  /**
   * Appends one piece. Pieces arrive in order; every piece but the last is
   * exactly `chunkBytes`, and together they are exactly the size announced,
   * so a truncated or padded upload is caught before ffmpeg ever sees it.
   */
  async appendChunk(
    user: AuthUser,
    id: string,
    index: number,
    chunk: Buffer,
  ): Promise<PromoVideoUploadStatus> {
    const session = this.owned(user, id);
    if (session.status !== 'UPLOADING') {
      throw new ConflictException('This upload has already been sent in full.');
    }
    if (index !== session.nextIndex) {
      throw new ConflictException(
        `Expected piece ${session.nextIndex + 1} of ${session.chunkCount}, got piece ${index + 1}.`,
      );
    }
    const isLast = index === session.chunkCount - 1;
    const expected = isLast ? session.sizeBytes - session.receivedBytes : PROMO_VIDEO.chunkBytes;
    if (chunk.byteLength !== expected) {
      throw new BadRequestException(
        `Piece ${index + 1} is ${chunk.byteLength} bytes; expected ${expected}.`,
      );
    }

    await appendFile(session.file, chunk);
    session.nextIndex += 1;
    session.receivedBytes += chunk.byteLength;
    session.touchedAt = Date.now();
    return this.statusOf(session);
  }

  /** Every piece is in: optimise it in the background and answer straight away. */
  complete(user: AuthUser, id: string): PromoVideoUploadStatus {
    const session = this.owned(user, id);
    if (session.status !== 'UPLOADING') return this.statusOf(session);
    if (session.receivedBytes !== session.sizeBytes) {
      throw new BadRequestException(
        `Only ${session.receivedBytes} of ${session.sizeBytes} bytes have arrived. Send the remaining pieces first.`,
      );
    }

    session.status = 'PROCESSING';
    session.touchedAt = Date.now();
    void this.process(session);
    return this.statusOf(session);
  }

  status(user: AuthUser, id: string): PromoVideoUploadStatus {
    const session = this.owned(user, id);
    session.touchedAt = Date.now();
    return this.statusOf(session);
  }

  /** The record a registering target made, once READY; null before, or for promo tiles. */
  assetIdOf(user: AuthUser, id: string): string | null {
    return this.owned(user, id).assetId;
  }

  private async process(session: Session): Promise<void> {
    const { folder, smallWidth, register } = session.target;
    const written: string[] = [];
    try {
      const processed = await this.videos.process(session.file, { smallWidth });
      const storeVideo = (buffer: Buffer) =>
        this.storage.uploadVideo(
          { folder, buffer, contentType: 'video/mp4', originalName: 'video.mp4' },
          PROMO_VIDEO.maxUploadBytes,
        );
      const [video, poster, small] = await Promise.all([
        storeVideo(processed.video),
        this.storage.uploadImage({
          folder,
          buffer: processed.poster,
          contentType: 'image/webp',
          originalName: 'poster.webp',
        }),
        processed.small ? storeVideo(processed.small) : Promise.resolve(null),
      ]);
      written.push(video.key, poster.key, ...(small ? [small.key] : []));
      const result: PromoTileVideoUpload = {
        videoUrl: video.url,
        posterUrl: poster.url,
        width: processed.width,
        height: processed.height,
        durationSeconds: Math.round(processed.durationSeconds * 10) / 10,
        sizeBytes: video.sizeBytes,
      };
      if (register) {
        session.assetId = await register({ result, smallUrl: small?.url ?? null, keys: written });
      }
      session.result = result;
      session.status = 'READY';
    } catch (error) {
      // Nothing half-recorded is kept: files without a record are unreachable.
      if (register) await Promise.all(written.map((key) => this.storage.delete(key)));
      session.status = 'FAILED';
      session.error =
        error instanceof UnreadableVideoError || error instanceof VideoProcessingUnavailableError
          ? error.message
          : 'The video could not be processed. Try again, or try a different file.';
      if (!(error instanceof UnreadableVideoError)) {
        this.logger.error(`Promo video ${session.id} failed: ${String(error)}`);
      }
    } finally {
      session.touchedAt = Date.now();
      // The upload itself is never kept, whatever happened.
      await rm(session.dir, { recursive: true, force: true });
    }
  }

  /** Someone else's upload is "not found", the same as one that does not exist. */
  private owned(user: AuthUser, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== user.id) {
      throw new NotFoundException('This upload has expired or does not exist. Start it again.');
    }
    return session;
  }

  private statusOf(session: Session): PromoVideoUploadStatus {
    return {
      uploadId: session.id,
      status: session.status,
      receivedBytes: session.receivedBytes,
      sizeBytes: session.sizeBytes,
      result: session.result,
      error: session.error,
    };
  }

  /** Drops uploads nobody has touched for an hour, and their files. Exposed for tests. */
  async sweep(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.status === 'PROCESSING') continue;
      if (now - session.touchedAt < UPLOAD_IDLE_MS) continue;
      await this.discard(session);
      removed += 1;
    }
    return removed;
  }

  private async discard(session: Session): Promise<void> {
    this.sessions.delete(session.id);
    await rm(session.dir, { recursive: true, force: true });
  }
}
