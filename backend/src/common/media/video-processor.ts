import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PROMO_VIDEO } from '@vintrax/shared';
import sharp from 'sharp';
import type { Env } from '../../config/env';

const run = promisify(execFile);

/** A transcode of a 30-second clip takes seconds; this is a guard, not an estimate. */
const TRANSCODE_TIMEOUT_MS = 5 * 60_000;

export class VideoProcessingUnavailableError extends Error {}
export class UnreadableVideoError extends Error {}

export interface ProcessedVideo {
  /** H.264 MP4, silent, `+faststart`, at most `PROMO_VIDEO.maxWidth` wide. */
  video: Buffer;
  /** A WebP frame from the start of the clip. */
  poster: Buffer;
  /**
   * A narrower, lighter rendition for phones, when one was asked for and the
   * video is wider than it. Null otherwise: the video itself is small enough.
   */
  small: Buffer | null;
  width: number;
  height: number;
  durationSeconds: number;
}

/** Reads the duration and frame size ffmpeg prints for an input. Exported for tests. */
export function readVideoInfo(
  stderr: string,
): { durationSeconds: number; width: number; height: number } | null {
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  const size = /Stream #\d+:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(stderr);
  if (!duration || !size) return null;
  return {
    durationSeconds: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
    width: Number(size[1]),
    height: Number(size[2]),
  };
}

/** The demuxers an upload may be read with: MP4/MOV (one demuxer) and WebM/Matroska. */
export const INPUT_FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm';

/**
 * The ffmpeg arguments that turn an upload into the file the site serves.
 * Exported for tests, which pin the parts that matter: no audio, no metadata,
 * a width cap with even dimensions, a length cap, and `+faststart` so the
 * browser can start playing before the whole file has arrived.
 */
export function transcodeArgs(input: string, output: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    // Read only local files, and only as a container a phone or camera writes.
    // Without this, ffmpeg probes the upload for any format it knows — an HLS
    // or concat playlist among them, which can pull in other local files or
    // URLs and encode them into the video the site then serves.
    '-protocol_whitelist',
    'file',
    '-format_whitelist',
    INPUT_FORMATS,
    '-i',
    input,
    '-t',
    String(PROMO_VIDEO.maxSeconds),
    // The tile is always muted, so sound would only be bytes nobody hears.
    '-an',
    '-sn',
    '-dn',
    // Camera metadata includes GPS coordinates.
    '-map_metadata',
    '-1',
    '-vf',
    `scale='trunc(min(${PROMO_VIDEO.maxWidth},iw)/2)*2':-2:flags=lanczos`,
    '-fpsmax',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '26',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ];
}

/**
 * The phone rendition, made from the already-optimised video rather than the
 * upload: it is a known-good H.264 file by then, so the input is not probed
 * for other formats. A higher CRF than the desktop file — a 6-inch screen
 * forgives more compression — and the same `+faststart`. Exported for tests.
 */
export function smallRenditionArgs(input: string, output: string, width: number): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-protocol_whitelist',
    'file',
    '-i',
    input,
    '-an',
    '-map_metadata',
    '-1',
    '-vf',
    `scale='trunc(min(${width},iw)/2)*2':-2:flags=lanczos`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ];
}

/**
 * Optimises an uploaded video for a promo tile and takes its poster frame.
 *
 * The upload is re-encoded before anything is stored, and only the result is
 * kept: a phone's 80 MB clip becomes a few megabytes, and the site never
 * serves an original. `execFile` passes arguments without a shell, and every
 * path is one this class created, so nothing from the upload reaches a
 * command line.
 */
@Injectable()
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name);
  private readonly ffmpeg: string;

  constructor(config: ConfigService<Env, true>) {
    this.ffmpeg = config.get('FFMPEG_PATH', { infer: true });
  }

  async process(inputPath: string, options: { smallWidth?: number } = {}): Promise<ProcessedVideo> {
    const workDir = await mkdtemp(join(tmpdir(), 'vintrax-video-'));
    const output = join(workDir, 'video.mp4');
    const smallOutput = join(workDir, 'small.mp4');
    const posterJpeg = join(workDir, 'poster.jpg');

    try {
      try {
        await run(this.ffmpeg, transcodeArgs(inputPath, output), {
          timeout: TRANSCODE_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new VideoProcessingUnavailableError(
            'Video processing is not available on this server (ffmpeg is not installed).',
          );
        }
        this.logger.warn(
          `ffmpeg could not read an uploaded video: ${String((error as Error).message).slice(-400)}`,
        );
        throw new UnreadableVideoError(
          'That file could not be read as a video. Upload an MP4, MOV or WebM file.',
        );
      }

      const info = await this.probe(output);
      if (!info) throw new UnreadableVideoError('The video has no picture to show.');

      // A frame just after the start: the very first is often black.
      const at = Math.min(0.5, info.durationSeconds / 2);
      await run(
        this.ffmpeg,
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-ss',
          at.toFixed(2),
          '-i',
          output,
          '-frames:v',
          '1',
          '-q:v',
          '2',
          posterJpeg,
        ],
        { timeout: 60_000 },
      );
      const poster = await sharp(await readFile(posterJpeg))
        .webp({ quality: 80 })
        .toBuffer();

      let small: Buffer | null = null;
      if (options.smallWidth && info.width > options.smallWidth) {
        await run(this.ffmpeg, smallRenditionArgs(output, smallOutput, options.smallWidth), {
          timeout: TRANSCODE_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
        });
        small = await readFile(smallOutput);
      }

      const video = await readFile(output);
      this.logger.log(
        `Optimised a promo video: ${(await stat(inputPath)).size} → ${video.byteLength} bytes, ${info.width}×${info.height}, ${info.durationSeconds.toFixed(1)} s`,
      );
      return { video, poster, small, ...info };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /** ffmpeg with an input and no output prints the stream details, then exits with an error. */
  private async probe(path: string) {
    try {
      await run(this.ffmpeg, ['-hide_banner', '-nostdin', '-i', path], { timeout: 30_000 });
      return null;
    } catch (error) {
      return readVideoInfo(String((error as { stderr?: string }).stderr ?? ''));
    }
  }
}
