'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import {
  PROMO_TILE_HEIGHT,
  PROMO_TILE_WIDTHS,
  PROMO_TILE_WIDTH_LABELS,
  normalizeFooterHref,
  type PromoTile,
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
        <ErrorAlert error={upload.error ?? save.error} />

        <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-md border border-dashed border-border bg-muted">
          {tile.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tile.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm text-muted-foreground">No photo — this box is not shown</span>
          )}
        </div>

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

        <Field label="Photo description" htmlFor={`${id}-alt`} hint="Read aloud by screen readers.">
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
          Three photo boxes under the last-search card on the home page. Each links to a page on
          Vintrax or another website. Choose each box&apos;s width and height; on a phone the boxes
          stack and keep their shape.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>
            As the home page will show them, with your unsaved changes. Hidden boxes and boxes
            without a photo are left out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.some((tile) => tile.imageUrl) ? (
            // Not clickable here: a slip would leave the editor with unsaved changes.
            <div className="pointer-events-none" aria-hidden>
              <PromoTileRow tiles={preview} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to show yet — upload a photo.</p>
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
