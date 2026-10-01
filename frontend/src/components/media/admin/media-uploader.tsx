'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, ImagePlus } from 'lucide-react';
import { MEDIA_IMAGE, MEDIA_VIDEO, type MediaAsset, type MediaKind } from '@vintrax/shared';
import { Button, ErrorAlert } from '@/components/ui';
import {
  acceptFor,
  checkMediaFile,
  labelFor,
  uploadMediaImage,
  uploadMediaVideo,
  type MediaUploadProgress,
} from '@/lib/media-upload';

/**
 * Adds a picture or a video to the media library.
 *
 * The file is checked in the browser first (type, size, dimensions), then
 * shown at once from the computer — so the administrator sees what is going
 * up while it goes — with real progress, then "optimising" while the server
 * makes its renditions. Errors say what to do in words, not codes.
 */
export function MediaUploader({
  kind,
  onUploaded,
  size = 'sm',
  label,
}: {
  kind: MediaKind;
  onUploaded: (asset: MediaAsset) => void;
  size?: 'sm' | 'default';
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<MediaUploadProgress | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Object URLs hold the file in memory until released.
  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  async function upload(file: File) {
    setError(null);
    const problem = await checkMediaFile(file, kind);
    if (problem) {
      setError(new Error(problem));
      return;
    }
    setLocalPreview(URL.createObjectURL(file));
    try {
      const asset =
        kind === 'IMAGE'
          ? await uploadMediaImage(file, labelFor(file), setProgress)
          : await uploadMediaVideo(file, labelFor(file), setProgress);
      onUploaded(asset);
    } catch (caught) {
      setError(caught);
    } finally {
      setProgress(null);
      setLocalPreview(null);
    }
  }

  const busy = progress !== null;
  const Icon = kind === 'IMAGE' ? ImagePlus : Film;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept={acceptFor(kind)}
        className="sr-only"
        aria-label={kind === 'IMAGE' ? 'Picture to upload' : 'Video to upload'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label ?? (kind === 'IMAGE' ? 'Upload a picture' : 'Upload a video')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {kind === 'IMAGE'
            ? `JPEG, PNG, WebP or AVIF, up to ${MEDIA_IMAGE.maxUploadBytes / 1024 / 1024} MB, at least ${MEDIA_IMAGE.minWidth}×${MEDIA_IMAGE.minHeight}.`
            : `MP4, MOV or WebM, up to ${MEDIA_VIDEO.maxUploadBytes / 1024 / 1024} MB. Sound is removed; past ${MEDIA_VIDEO.maxSeconds} seconds is cut.`}
        </span>
      </div>

      {busy ? (
        <div
          className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-2"
          role="status"
        >
          <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
            {localPreview ? (
              kind === 'IMAGE' ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local file being uploaded
                <img src={localPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                // `#t=0.1` asks for a frame to show while the file uploads.
                <video
                  src={`${localPreview}#t=0.1`}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              )
            ) : null}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            {progress?.phase === 'uploading' ? (
              <>
                <p>Uploading… {progress.percent}%</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </>
            ) : (
              <p>
                {kind === 'IMAGE'
                  ? 'Making sizes for every screen…'
                  : 'Optimising the video for the web — this can take a minute.'}
              </p>
            )}
          </div>
        </div>
      ) : null}

      <ErrorAlert error={error} />
    </div>
  );
}
