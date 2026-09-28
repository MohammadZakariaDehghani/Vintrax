'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, ImageIcon, ImagePlus } from 'lucide-react';
import {
  PROMO_TILE_HEIGHT,
  PROMO_TILE_WIDTHS,
  PROMO_TILE_WIDTH_LABELS,
  PROMO_VIDEO,
  normalizeFooterHref,
  promoTileHasMedia,
  type PromoTile,
  type PromoTileMediaType,
  type PromoTileVideoUpload,
  type PromoTileWidth,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { PromoTileRow } from '@/components/promo-tiles';
import { PromoTileVideo } from '@/components/promo-tile-video';
import { cn } from '@/lib/utils';
import { uploadPromoVideo, type PromoVideoProgress } from '@/lib/promo-video-upload';

/** Blank fields go as null, so clearing one removes it. */
function payloadFrom(tile: PromoTile) {
  const orNull = (value: string | null) => (value?.trim() ? value.trim() : null);
  return {
    imageUrl: orNull(tile.imageUrl),
    imageAlt: orNull(tile.imageAlt),
    linkUrl: orNull(tile.linkUrl),
    widthSpan: tile.widthSpan,
    heightPx: tile.heightPx,
    enabled: tile.enabled,
    mediaType: tile.mediaType,
    videoUrl: tile.videoUrl,
    videoPosterUrl: tile.videoPosterUrl,
  };
}

function clampHeight(value: number) {
  if (!Number.isFinite(value)) return PROMO_TILE_HEIGHT.default;
  return Math.min(PROMO_TILE_HEIGHT.max, Math.max(PROMO_TILE_HEIGHT.min, Math.round(value)));
}

function SlotEditor({ tile, onChange }: { tile: PromoTile; onChange: (next: PromoTile) => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [saved, setSaved] = useState(false);
  const id = `tile-${tile.slot}`;
  const set = <K extends keyof PromoTile>(key: K, value: PromoTile[K]) => {
    setSaved(false);
    onChange({ ...tile, [key]: value });
  };

  const upload = useMutation({
    mutationFn: (file: File) => api.upload<{ url: string }>('/uploads/promo-tiles', file),
    onSuccess: (stored) => set('imageUrl', stored.url),
  });

  const videoInput = useRef<HTMLInputElement | null>(null);
  const [videoInfo, setVideoInfo] = useState<PromoTileVideoUpload | null>(null);
  const [videoProgress, setVideoProgress] = useState<PromoVideoProgress | null>(null);
  const uploadVideo = useMutation({
    mutationFn: (file: File) => uploadPromoVideo(file, setVideoProgress),
    onSettled: () => setVideoProgress(null),
    onSuccess: (stored) => {
      setVideoInfo(stored);
      setSaved(false);
      onChange({
        ...tile,
        mediaType: 'VIDEO',
        videoUrl: stored.videoUrl,
        videoPosterUrl: stored.posterUrl,
      });
    },
  });
  const isVideo = tile.mediaType === 'VIDEO';

  const save = useMutation({
    mutationFn: () => api.put<PromoTile>(`/admin/promo-tiles/${tile.slot}`, payloadFrom(tile)),
    onSuccess: (result) => {
      onChange(result);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['admin-promo-tiles'] });
    },
  });

  const linkHint =
    tile.linkUrl?.trim() && normalizeFooterHref(tile.linkUrl) !== tile.linkUrl.trim()
      ? `Saved as ${normalizeFooterHref(tile.linkUrl)}`
      : 'A website such as example.com (opens in a new tab), or a page here starting with /.';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Box {tile.slot}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ErrorAlert error={upload.error ?? uploadVideo.error ?? save.error} />

        <div>
          <p className="mb-1.5 text-sm font-medium">Media</p>
          <div
            className="inline-flex rounded-md border border-border p-0.5"
            role="radiogroup"
            aria-label={`Media for box ${tile.slot}`}
          >
            {(
              [
                ['IMAGE', ImageIcon, 'Image'],
                ['VIDEO', Film, 'Video'],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={tile.mediaType === value}
                onClick={() => set('mediaType', value as PromoTileMediaType)}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors',
                  tile.mediaType === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The width and height below apply to either. Switching keeps the other one, so you can
            switch back.
          </p>
        </div>

        <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-md border border-dashed border-border bg-muted">
          {isVideo && tile.videoUrl ? (
            <PromoTileVideo
              key={tile.videoUrl}
              src={tile.videoUrl}
              poster={tile.videoPosterUrl}
              fallbackImageUrl={tile.imageUrl}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : !isVideo && tile.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tile.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="px-4 text-center text-sm text-muted-foreground">
              {isVideo ? 'No video — this box is not shown' : 'No photo — this box is not shown'}
            </span>
          )}
          {uploadVideo.isPending ? (
            <div
              role="status"
              className="absolute inset-0 grid place-items-center bg-background/85 px-4 text-center text-sm"
            >
              {videoProgress?.phase === 'uploading' ? (
                <div className="w-full max-w-[220px]">
                  <p>Uploading… {videoProgress.percent}%</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${videoProgress.percent}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p>Optimising the video for the web — this can take a minute.</p>
              )}
            </div>
          ) : null}
        </div>

        {isVideo ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={videoInput}
                id={`${id}-video`}
                type="file"
                accept={PROMO_VIDEO.acceptedTypes.join(',')}
                className="sr-only"
                aria-label={`Video for box ${tile.slot}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadVideo.mutate(file);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={uploadVideo.isPending}
                onClick={() => videoInput.current?.click()}
              >
                <Film className="h-4 w-4" aria-hidden />
                {tile.videoUrl ? 'Replace video' : 'Upload video'}
              </Button>
              {tile.videoUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setVideoInfo(null);
                    onChange({ ...tile, videoUrl: null, videoPosterUrl: null });
                    setSaved(false);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              MP4, MOV or WebM, up to {PROMO_VIDEO.maxUploadBytes / 1024 / 1024} MB. It plays
              silently on a loop, filling the box like a photo; sound is removed and anything past{' '}
              {PROMO_VIDEO.maxSeconds} seconds is cut.
              {videoInfo
                ? ` Optimised to ${videoInfo.width}×${videoInfo.height}, ${videoInfo.durationSeconds} s, ${(videoInfo.sizeBytes / 1024 / 1024).toFixed(1)} MB.`
                : ''}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            id={`${id}-image`}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            className="sr-only"
            aria-label={`Photo for box ${tile.slot}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            {tile.imageUrl ? 'Replace photo' : 'Upload photo'}
          </Button>
          {tile.imageUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set('imageUrl', null)}>
              Remove
            </Button>
          ) : null}
          {isVideo ? (
            <span className="w-full text-xs text-muted-foreground">
              Optional for a video: shown if the video cannot play. A frame of the video is used
              otherwise.
            </span>
          ) : null}
        </div>

        <Field label="Link" htmlFor={`${id}-link`} hint={linkHint}>
          <Input
            id={`${id}-link`}
            maxLength={500}
            placeholder="example.com/offer or /vehicles?bodyType=SUV"
            value={tile.linkUrl ?? ''}
            onChange={(e) => set('linkUrl', e.target.value)}
          />
        </Field>

        <Field label="Description" htmlFor={`${id}-alt`} hint="Read aloud by screen readers.">
          <Input
            id={`${id}-alt`}
            maxLength={160}
            value={tile.imageAlt ?? ''}
            onChange={(e) => set('imageAlt', e.target.value)}
          />
        </Field>

        <Field label="Width" htmlFor={`${id}-width`} hint="Of the row, on a computer screen.">
          <Select
            id={`${id}-width`}
            value={tile.widthSpan}
            onChange={(e) => set('widthSpan', Number(e.target.value) as PromoTileWidth)}
          >
            {PROMO_TILE_WIDTHS.map((width) => (
              <option key={width} value={width}>
                {PROMO_TILE_WIDTH_LABELS[width]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={`Height: ${tile.heightPx}px`}
          htmlFor={`${id}-height`}
          hint="On a wide screen. Smaller screens scale the box down and keep its shape."
        >
          <div className="flex items-center gap-3">
            <input
              id={`${id}-height`}
              type="range"
              min={PROMO_TILE_HEIGHT.min}
              max={PROMO_TILE_HEIGHT.max}
              step={10}
              value={tile.heightPx}
              onChange={(e) => set('heightPx', clampHeight(Number(e.target.value)))}
              className="flex-1 accent-primary"
            />
            <Input
              type="number"
              aria-label={`Height of box ${tile.slot} in pixels`}
              min={PROMO_TILE_HEIGHT.min}
              max={PROMO_TILE_HEIGHT.max}
              value={tile.heightPx}
              onChange={(e) => set('heightPx', clampHeight(Number(e.target.value)))}
              className="w-24"
            />
          </div>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={tile.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          Show on the home page
        </label>

        <div className="flex items-center gap-3">
          <Button type="button" loading={save.isPending} onClick={() => save.mutate()}>
            Save box {tile.slot}
          </Button>
          {saved ? (
            <span role="status" className="text-sm text-muted-foreground">
              Saved.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PromoTilesAdmin() {
  const tiles = useQuery({
    queryKey: ['admin-promo-tiles'],
    queryFn: () => api.get<PromoTile[]>('/admin/promo-tiles'),
  });
  const [drafts, setDrafts] = useState<PromoTile[] | null>(null);

  // Loaded once into editable drafts; a save replaces only its own slot, so
  // unsaved edits in the other boxes survive it.
  useEffect(() => {
    if (tiles.data && drafts === null) setDrafts(tiles.data);
  }, [tiles.data, drafts]);

  if (tiles.isPending || (tiles.data && drafts === null)) return <Spinner label="Loading" />;
  if (tiles.error || !drafts) return <ErrorAlert error={tiles.error} />;

  const preview = drafts.filter((tile) => tile.enabled);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Home page boxes</h1>
        <p className="text-sm text-muted-foreground">
          Three boxes under the last-search card on the home page, each showing a photo or a silent
          looping video. Each links to a page on Vintrax or another website. Choose each box&apos;s
          width and height — they apply to a photo and a video alike; on a phone the boxes stack and
          keep their shape.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>
            As the home page will show them, with your unsaved changes. Hidden boxes, and boxes
            without their photo or video, are left out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.some(promoTileHasMedia) ? (
            // Not clickable here: a slip would leave the editor with unsaved changes.
            <div className="pointer-events-none" aria-hidden>
              <PromoTileRow tiles={preview} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing to show yet — upload a photo or a video.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {drafts.map((tile) => (
          <SlotEditor
            key={tile.slot}
            tile={tile}
            onChange={(next) =>
              setDrafts((current) =>
                (current ?? []).map((entry) => (entry.slot === next.slot ? next : entry)),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

export default function AdminPromoTilesPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <PromoTilesAdmin />
      </div>
    </RequireAuth>
  );
}
