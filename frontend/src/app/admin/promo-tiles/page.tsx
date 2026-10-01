'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  PROMO_TILE_HEIGHT,
  PROMO_TILE_MAX_SLOTS,
  PROMO_TILE_WIDTHS,
  PROMO_TILE_WIDTH_LABELS,
  normalizeFooterHref,
  promoTileMedia,
  type MediaPresentation,
  type PromoTile,
  type PromoTileWidth,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { toMediaInput } from '@/lib/media-input';
import {
  Badge,
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
  Textarea,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { MediaEditor } from '@/components/media/admin/media-editor';
import { LivePreview } from '@/components/media/admin/live-preview';

const QUERY_KEY = ['admin-promo-tiles'] as const;

/** A box as the editor holds it: the saved box with its media resolved for editing. */
interface Draft extends PromoTile {
  /** Unsaved edits; also what the preview draws. */
  dirty: boolean;
}

const orNull = (value: string | null) => (value?.trim() ? value.trim() : null);

function draftOf(tile: PromoTile): Draft {
  // A box saved before the library edits its old photo or video as media.
  return { ...tile, media: promoTileMedia(tile), dirty: false };
}

function emptyBox(slot: number): Draft {
  return {
    slot,
    title: null,
    body: null,
    ctaLabel: null,
    media: null,
    imageUrl: null,
    imageAlt: null,
    linkUrl: null,
    widthSpan: 4,
    heightPx: PROMO_TILE_HEIGHT.default,
    enabled: true,
    mediaType: 'IMAGE',
    videoUrl: null,
    videoPosterUrl: null,
    updatedAt: null,
    dirty: true,
  };
}

function payloadFrom(tile: Draft) {
  return {
    title: orNull(tile.title),
    body: orNull(tile.body),
    ctaLabel: orNull(tile.ctaLabel),
    media: toMediaInput(tile.media),
    imageAlt: orNull(tile.media?.alt ?? tile.imageAlt),
    linkUrl: orNull(tile.linkUrl),
    widthSpan: tile.widthSpan,
    heightPx: tile.heightPx,
    enabled: tile.enabled,
    // Removing the media removes what the box was saved with before the
    // library too; otherwise that photo or video would quietly come back.
    ...(tile.media
      ? { imageUrl: tile.imageUrl }
      : { imageUrl: null, mediaType: 'IMAGE' as const, videoUrl: null, videoPosterUrl: null }),
  };
}

function clampHeight(value: number) {
  if (!Number.isFinite(value)) return PROMO_TILE_HEIGHT.default;
  return Math.min(PROMO_TILE_HEIGHT.max, Math.max(PROMO_TILE_HEIGHT.min, Math.round(value)));
}

function BoxEditor({
  tile,
  index,
  savedIndex,
  savedCount,
  canArrange,
  onChange,
  onSaved,
  onMove,
  onDelete,
  arranging,
}: {
  tile: Draft;
  index: number;
  /** Its place among saved boxes, which are the ones that can move; -1 if unsaved. */
  savedIndex: number;
  savedCount: number;
  canArrange: boolean;
  onChange: (next: Draft) => void;
  onSaved: (saved: PromoTile) => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
  arranging: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const id = `box-${tile.slot}`;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...tile, [key]: value, dirty: true });

  const save = useMutation({
    mutationFn: () => api.put<PromoTile>(`/admin/promo-tiles/${tile.slot}`, payloadFrom(tile)),
    onSuccess: onSaved,
  });

  const linkHint =
    tile.linkUrl?.trim() && normalizeFooterHref(tile.linkUrl) !== tile.linkUrl.trim()
      ? `Saved as ${normalizeFooterHref(tile.linkUrl)}`
      : 'A website such as example.com (opens in a new tab), or a page here starting with /.';
  const saved = tile.updatedAt !== null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          Box {index + 1}
          <Badge variant={tile.enabled && tile.media ? 'success' : 'outline'}>
            {!tile.media ? 'Empty' : tile.enabled ? 'Active' : 'Draft'}
          </Badge>
          {tile.dirty ? <Badge variant="warning">Unsaved</Badge> : null}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Move box ${index + 1} earlier`}
            disabled={!canArrange || savedIndex <= 0 || arranging}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Move box ${index + 1} later`}
            disabled={!canArrange || savedIndex < 0 || savedIndex >= savedCount - 1 || arranging}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </Button>
          {confirming ? (
            <>
              <Button variant="destructive" size="sm" onClick={onDelete} loading={arranging}>
                Yes, delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete box ${index + 1}`}
              disabled={saved && !canArrange}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ErrorAlert error={save.error} />

        <MediaEditor
          idPrefix={id}
          value={tile.media}
          onChange={(media) => set('media', media as MediaPresentation | null)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Title over the media"
            htmlFor={`${id}-title`}
            hint="Optional. Real text, not part of the picture."
          >
            <Input
              id={`${id}-title`}
              maxLength={80}
              value={tile.title ?? ''}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field
            label="Button text"
            htmlFor={`${id}-cta`}
            hint="Optional. The whole box is the link either way."
          >
            <Input
              id={`${id}-cta`}
              maxLength={40}
              placeholder="Shop now"
              value={tile.ctaLabel ?? ''}
              onChange={(e) => set('ctaLabel', e.target.value)}
            />
          </Field>
          <Field
            label="A line of text"
            htmlFor={`${id}-body`}
            hint="Optional."
            className="sm:col-span-2"
          >
            <Textarea
              id={`${id}-body`}
              rows={2}
              maxLength={240}
              value={tile.body ?? ''}
              onChange={(e) => set('body', e.target.value)}
            />
          </Field>
          <Field label="Link" htmlFor={`${id}-link`} hint={linkHint} className="sm:col-span-2">
            <Input
              id={`${id}-link`}
              maxLength={500}
              placeholder="example.com/offer or /vehicles?bodyType=SUV"
              value={tile.linkUrl ?? ''}
              onChange={(e) => set('linkUrl', e.target.value)}
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
          <Field label="Status" htmlFor={`${id}-status`} hint="A draft is saved but not shown.">
            <Select
              id={`${id}-status`}
              value={tile.enabled ? 'ACTIVE' : 'DRAFT'}
              onChange={(e) => set('enabled', e.target.value === 'ACTIVE')}
            >
              <option value="ACTIVE">Active — on the home page</option>
              <option value="DRAFT">Draft — hidden</option>
            </Select>
          </Field>
          <Field
            label={`Height: ${tile.heightPx}px`}
            htmlFor={`${id}-height`}
            hint="On a wide screen. Smaller screens scale the box down and keep its shape."
            className="sm:col-span-2"
          >
            <input
              id={`${id}-height`}
              type="range"
              min={PROMO_TILE_HEIGHT.min}
              max={PROMO_TILE_HEIGHT.max}
              step={10}
              value={tile.heightPx}
              onChange={(e) => set('heightPx', clampHeight(Number(e.target.value)))}
              className="accent-primary"
            />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            loading={save.isPending}
            disabled={!tile.dirty}
            onClick={() => save.mutate()}
          >
            {saved ? 'Save box' : 'Create box'}
          </Button>
          {!tile.media ? (
            <span className="text-xs text-muted-foreground">
              Without a picture or video, a box is not shown.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PromoTilesAdmin() {
  const queryClient = useQueryClient();
  const tiles = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<PromoTile[]>('/admin/promo-tiles'),
  });
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  // Loaded once into editable drafts; a save replaces only its own box, so
  // unsaved edits in the others survive it.
  useEffect(() => {
    if (tiles.data && drafts === null) setDrafts(tiles.data.map(draftOf));
  }, [tiles.data, drafts]);

  // Straight from the API, not the query cache: moving and deleting renumber
  // the boxes, and a cached list would put edits back on the wrong ones.
  const reload = async () => {
    const fresh = await api.get<PromoTile[]>('/admin/promo-tiles');
    queryClient.setQueryData(QUERY_KEY, fresh);
    setDrafts(fresh.map(draftOf));
  };

  const arrange = useMutation({
    mutationFn: async (
      action: { kind: 'move'; slots: number[] } | { kind: 'delete'; slot: number },
    ) => {
      if (action.kind === 'move')
        await api.put('/admin/promo-tiles/order', { slots: action.slots });
      else await api.delete(`/admin/promo-tiles/${action.slot}`);
    },
    onSuccess: reload,
  });

  const preview = useMemo(
    () =>
      drafts ? { kind: 'boxes' as const, tiles: drafts.filter((tile) => tile.enabled) } : null,
    [drafts],
  );

  if (tiles.isPending || (tiles.data && drafts === null)) return <Spinner label="Loading" />;
  if (tiles.error || !drafts) return <ErrorAlert error={tiles.error} />;

  const saved = drafts.filter((tile) => tile.updatedAt !== null);
  // Moving or deleting renumbers boxes on the server, so it waits until every
  // edit is saved — otherwise an unsaved change could land on the wrong box.
  // A fresh, still-empty box has nothing to lose, so it does not hold this up.
  const canArrange = !drafts.some(
    (tile) => tile.dirty && (tile.updatedAt !== null || tile.media || tile.title || tile.body),
  );

  /** Swaps a saved box with the saved box before or after it. */
  function move(slot: number, by: -1 | 1) {
    const order = saved.map((tile) => tile.slot);
    const index = order.indexOf(slot);
    const target = index + by;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    arrange.mutate({ kind: 'move', slots: order });
  }
  const savedIndex = (slot: number) => saved.findIndex((tile) => tile.slot === slot);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Home page boxes</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Boxes under the last-search card on the home page, in the order below. Each shows a
            picture or a silent looping video, optional words over it, and links to a page here or
            another website. Choose each box&apos;s width and height; on a phone they stack and keep
            their shape.
          </p>
        </div>
        <Button
          disabled={drafts.length >= PROMO_TILE_MAX_SLOTS}
          onClick={() =>
            setDrafts((current) => [...(current ?? []), emptyBox((current?.at(-1)?.slot ?? 0) + 1)])
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add a box
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>
            As the home page will show them, with your unsaved changes. Drafts and boxes without
            media are left out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LivePreview payload={preview} />
        </CardContent>
      </Card>

      <ErrorAlert error={arrange.error} />
      {!canArrange ? (
        <p className="text-sm text-muted-foreground">Save your changes to move or delete boxes.</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {drafts.map((tile, index) => (
          <BoxEditor
            key={tile.slot}
            tile={tile}
            index={index}
            savedIndex={savedIndex(tile.slot)}
            savedCount={saved.length}
            canArrange={canArrange}
            arranging={arrange.isPending}
            onChange={(next) =>
              setDrafts((current) =>
                (current ?? []).map((entry) => (entry.slot === next.slot ? next : entry)),
              )
            }
            onSaved={(result) =>
              setDrafts((current) =>
                (current ?? []).map((entry) =>
                  entry.slot === result.slot ? draftOf(result) : entry,
                ),
              )
            }
            onMove={(by) => move(tile.slot, by)}
            onDelete={() =>
              tile.updatedAt === null
                ? setDrafts((current) =>
                    (current ?? []).filter((entry) => entry.slot !== tile.slot),
                  )
                : arrange.mutate({ kind: 'delete', slot: tile.slot })
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
