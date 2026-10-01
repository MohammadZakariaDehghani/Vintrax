import {
  PROMO_VIDEO,
  type PromoTileVideoUpload,
  type PromoVideoUploadSession,
  type PromoVideoUploadStatus,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';

export type PromoVideoProgress = { phase: 'uploading'; percent: number } | { phase: 'processing' };

const BY_EXTENSION: Record<string, (typeof PROMO_VIDEO.acceptedTypes)[number]> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

/**
 * The type to announce for a file. Browsers leave `File.type` empty for some
 * files (a .mov on Windows, say), so the extension is the fallback.
 */
export function videoContentType(file: Pick<File, 'type' | 'name'>): string {
  if ((PROMO_VIDEO.acceptedTypes as readonly string[]).includes(file.type)) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? file.type;
}

const POLL_EVERY_MS = 2000;
const GIVE_UP_AFTER_MS = 15 * 60_000;

/** What every upload session's status shares, whatever it produces. */
interface SessionStatus {
  status: PromoVideoUploadStatus['status'];
  error: string | null;
}

/**
 * Sends a video in pieces to an upload-session endpoint, then waits while the
 * server optimises it, and returns the final status. No request carries more
 * than one piece — so a proxy's body limit never sees the whole file — and
 * none waits on the encoder. Shared by promo tiles and the media library.
 */
export async function sendVideoInPieces<T extends SessionStatus>(
  sessionsPath: string,
  file: File,
  onProgress: (progress: PromoVideoProgress) => void,
  wait: (ms: number) => Promise<void>,
  extra: Record<string, unknown> = {},
): Promise<T> {
  if (file.size > PROMO_VIDEO.maxUploadBytes) {
    throw new Error(`Videos can be up to ${PROMO_VIDEO.maxUploadBytes / 1024 / 1024} MB.`);
  }

  const session = await api.post<PromoVideoUploadSession>(sessionsPath, {
    sizeBytes: file.size,
    contentType: videoContentType(file),
    ...extra,
  });
  const base = `${sessionsPath}/${session.uploadId}`;

  onProgress({ phase: 'uploading', percent: 0 });
  for (let index = 0; index < session.chunkCount; index += 1) {
    const start = index * session.chunkBytes;
    const piece = file.slice(start, Math.min(start + session.chunkBytes, file.size));
    await api.upload<T>(
      `${base}/chunks/${index}`,
      new File([piece], 'piece', { type: 'application/octet-stream' }),
    );
    onProgress({
      phase: 'uploading',
      percent: Math.round(((index + 1) / session.chunkCount) * 100),
    });
  }

  let status = await api.post<T>(`${base}/complete`);
  onProgress({ phase: 'processing' });

  const deadline = Date.now() + GIVE_UP_AFTER_MS;
  while (status.status === 'PROCESSING' || status.status === 'UPLOADING') {
    if (Date.now() > deadline) {
      throw new Error('Optimising the video is taking too long. Try a shorter clip.');
    }
    await wait(POLL_EVERY_MS);
    status = await api.get<T>(base);
  }

  if (status.status === 'FAILED') {
    throw new Error(status.error ?? 'The video could not be processed.');
  }
  return status;
}

/** Uploads a promo tile video in pieces and returns where it was stored. */
export async function uploadPromoVideo(
  file: File,
  onProgress: (progress: PromoVideoProgress) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<PromoTileVideoUpload> {
  const status = await sendVideoInPieces<PromoVideoUploadStatus>(
    '/uploads/promo-tiles/video/sessions',
    file,
    onProgress,
    wait,
  );
  if (!status.result) throw new Error(status.error ?? 'The video could not be processed.');
  return status.result;
}
