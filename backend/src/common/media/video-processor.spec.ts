import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  UnreadableVideoError,
  VideoProcessingUnavailableError,
  VideoProcessor,
  readVideoInfo,
  transcodeArgs,
} from './video-processor';

/**
 * Promo tile videos are re-encoded before anything is stored. The arguments
 * are pinned here, and — where ffmpeg is installed — so is what they produce.
 */

const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;

function processor(path = FFMPEG) {
  return new VideoProcessor(new ConfigService({ FFMPEG_PATH: path }) as never);
}

describe('transcode arguments', () => {
  const args = transcodeArgs('/tmp/in', '/tmp/out.mp4');
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it('drops sound, subtitles, data and metadata such as GPS', () => {
    expect(args).toEqual(expect.arrayContaining(['-an', '-sn', '-dn']));
    expect(after('-map_metadata')).toBe('-1');
  });

  it('caps the length at 30 seconds and the width at 1920 pixels, with even sides', () => {
    expect(after('-t')).toBe('30');
    expect(after('-vf')).toContain('min(1920,iw)');
    expect(after('-vf')).toContain('trunc(');
    expect(after('-vf')).toContain(':-2');
  });

  it('writes H.264 that starts playing before it has fully arrived', () => {
    expect(after('-c:v')).toBe('libx264');
    expect(after('-pix_fmt')).toBe('yuv420p');
    expect(after('-movflags')).toBe('+faststart');
  });

  it('keeps the input and output as separate arguments, never through a shell', () => {
    expect(args).toContain('/tmp/in');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
  });
});

describe('reading ffmpeg output', () => {
  it('finds the duration and the frame size', () => {
    const stderr = `Input #0, mov,mp4, from 'x.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 1200 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 30 fps`;
    expect(readVideoInfo(stderr)).toEqual({ durationSeconds: 62.5, width: 1280, height: 720 });
  });

  it('gives nothing for a file with no picture', () => {
    expect(readVideoInfo('Duration: 00:00:03.00\n  Stream #0:0: Audio: aac')).toBeNull();
  });
});

describe('without ffmpeg', () => {
  it('says video processing is unavailable rather than storing the original', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-'));
    const input = join(dir, 'in.mp4');
    writeFileSync(input, 'not a video');
    await expect(processor('/nonexistent/ffmpeg').process(input)).rejects.toBeInstanceOf(
      VideoProcessingUnavailableError,
    );
  });
});

(hasFfmpeg ? describe : describe.skip)('with ffmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-'));

  function clip(name: string, size: string, seconds: number, withAudio: boolean): string {
    const path = join(dir, name);
    execFileSync(FFMPEG, [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${size}:rate=50`,
      ...(withAudio ? ['-f', 'lavfi', '-i', 'sine=frequency=440'] : []),
      '-t',
      String(seconds),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      ...(withAudio ? ['-c:a', 'aac'] : []),
      path,
    ]);
    return path;
  }

  it('shrinks a large landscape clip, removes its sound and takes a poster', async () => {
    const result = await processor().process(clip('wide.mp4', '2560x1440', 3, true));

    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.durationSeconds).toBeGreaterThan(2.5);

    const outPath = join(dir, 'out.mp4');
    writeFileSync(outPath, result.video);
    const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', outPath]).stderr.toString();
    expect(probe).toContain('Video: h264');
    expect(probe).not.toContain('Audio:');

    const poster = await sharp(result.poster).metadata();
    expect(poster.format).toBe('webp');
    expect(poster.width).toBe(1920);
  }, 60_000);

  it('keeps a portrait clip portrait, at its own size', async () => {
    const result = await processor().process(clip('tall.mp4', '720x1280', 2, false));
    expect({ width: result.width, height: result.height }).toEqual({ width: 720, height: 1280 });
  }, 60_000);

  it('cuts anything past 30 seconds', async () => {
    const result = await processor().process(clip('long.mp4', '320x240', 33, false));
    expect(result.durationSeconds).toBeLessThanOrEqual(30.1);
  }, 60_000);

  it('refuses a file that is not a video', async () => {
    const input = join(dir, 'fake.mp4');
    writeFileSync(input, Buffer.from('%PDF-1.7 not a video at all'));
    await expect(processor().process(input)).rejects.toBeInstanceOf(UnreadableVideoError);
  }, 30_000);
});
