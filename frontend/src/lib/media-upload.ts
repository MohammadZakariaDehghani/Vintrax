import {
  MEDIA_IMAGE,
  MEDIA_VIDEO,
  type MediaAsset,
  type MediaKind,
  type MediaVideoUploadStatus,
} from '@vintrax/shared';
import { ApiError, api, tokenStore, vintraxClientConfig } from '@/lib/api-client';
import {
  sendVideoInPieces,
  videoContentType,
  type PromoVideoProgress,
} from '@/lib/promo-video-upload';

export type MediaUploadProgress = PromoVideoProgress;

const IMAGE_EXTENSIONS: Record<string, (typeof MEDIA_IMAGE.acceptedTypes)[number]> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** The accept attribute for a file input of this kind. */
export function acceptFor(kind: MediaKind): string {
  return kind === 'IMAGE'
    ? MEDIA_IMAGE.acceptedTypes.join(',')
    : MEDIA_VIDEO.acceptedTypes.join(',');
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * Checks a file before a byte is sent — its type, size and, for a picture,
 * its dimensions — so an administrator hears at once what is wrong rather
 * than after an upload. The API checks every one of these again, by the
 * file's bytes; this is for speed, not trust.
 */
export async function checkMediaFile(
  file: File,
  kind: MediaKind,
  readSize: (file: File) => Promise<{ width: number; height: number } | null> = imageSize,
): Promise<string | null> {
  if (file.size === 0) return 'The file is empty.';
  if (kind === 'IMAGE') {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const type = (MEDIA_IMAGE.acceptedTypes as readonly string[]).includes(file.type)
      ? file.type
      : IMAGE_EXTENSIONS[extension];
    if (!type) return 'Upload a JPEG, PNG, WebP or AVIF picture.';
    if (file.size > MEDIA_IMAGE.maxUploadBytes) {
      return `Pictures can be up to ${megabytes(MEDIA_IMAGE.maxUploadBytes)}. This one is ${megabytes(file.size)}.`;
    }
    const size = await readSize(file);
    if (size) {
      if (size.width < MEDIA_IMAGE.minWidth || size.height < MEDIA_IMAGE.minHeight) {
        return `This picture is ${size.width}×${size.height} pixels. Use one at least ${MEDIA_IMAGE.minWidth}×${MEDIA_IMAGE.minHeight}, or it will look blurry.`;
      }
      if (Math.max(size.width, size.height) > MEDIA_IMAGE.maxDimension) {
        return `This picture is ${size.width}×${size.height} pixels. Use one no larger than ${MEDIA_IMAGE.maxDimension} pixels on its longest side.`;
      }
    }
    return null;
  }
  if (!(MEDIA_VIDEO.acceptedTypes as readonly string[]).includes(videoContentType(file))) {
    return 'Upload an MP4, MOV or WebM video.';
  }
  if (file.size > MEDIA_VIDEO.maxUploadBytes) {
    return `Videos can be up to ${megabytes(MEDIA_VIDEO.maxUploadBytes)}. This one is ${megabytes(file.size)}.`;
  }
  return null;
}

/** A picture's pixel size, read in the browser; null where it cannot be (AVIF in an old browser). */
async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'undefined') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Adds a picture to the media library with real upload progress — which
 * `fetch` cannot report, hence XMLHttpRequest. An expired session falls back
 * to the API client, which refreshes the token and retries.
 */
export function uploadMediaImage(
  file: File,
  label: string | null,
  onProgress: (progress: MediaUploadProgress) => void,
): Promise<MediaAsset> {
  const form = new FormData();
  form.append('file', file);
  if (label) form.append('label', label);

  return new Promise<MediaAsset>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${vintraxClientConfig().apiBaseUrl}/uploads/media/images`);
    const token = tokenStore.access;
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      onProgress(percent >= 100 ? { phase: 'processing' } : { phase: 'uploading', percent });
    };
    request.onload = () => {
      if (request.status === 401) {
        api
          .upload<MediaAsset>('/uploads/media/images', file, label ? { label } : {})
          .then(resolve, reject);
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // An HTML error page from a proxy, say.
      }
      if (request.status >= 200 && request.status < 300) {
        resolve(body as MediaAsset);
        return;
      }
      const message =
        request.status === 413
          ? 'The file is larger than the server accepts. Try a smaller picture.'
          : ((body as { message?: string | string[] } | null)?.message ?? 'The upload failed.');
      reject(new ApiError(request.status, Array.isArray(message) ? message.join(' ') : message));
    };
    request.onerror = () =>
      reject(new Error('The upload was interrupted. Check the connection and try again.'));
    onProgress({ phase: 'uploading', percent: 0 });
    request.send(form);
  });
}

/** Adds a video to the media library: sent in pieces, optimised on the server. */
export async function uploadMediaVideo(
  file: File,
  label: string | null,
  onProgress: (progress: MediaUploadProgress) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<MediaAsset> {
  const status = await sendVideoInPieces<MediaVideoUploadStatus>(
    '/uploads/media/videos/sessions',
    file,
    onProgress,
    wait,
    label ? { label } : {},
  );
  if (!status.assetId) throw new Error(status.error ?? 'The video could not be processed.');
  return api.get<MediaAsset>(`/admin/media/${status.assetId}`);
}

/** A library name from a file name: no extension, no folders. */
export function labelFor(file: File): string {
  return (
    file.name
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[A-Za-z0-9]{1,5}$/, '')
      .slice(0, 120) || 'Untitled'
  );
}
