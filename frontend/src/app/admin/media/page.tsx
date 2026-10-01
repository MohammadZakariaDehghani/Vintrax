'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { MediaAsset, MediaKind, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Pagination,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { MediaThumb } from '@/components/media/admin/media-thumb';
import { MediaUploader } from '@/components/media/admin/media-uploader';
import { MEDIA_LIBRARY_KEY } from '@/components/media/admin/media-library-picker';

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/** One asset, opened: a large preview, its name and description, and delete. */
function AssetDialog({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(asset.label);
  const [alt, setAlt] = useState(asset.alt ?? '');
  const [confirming, setConfirming] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });

  const usage = useQuery({
    queryKey: [...MEDIA_LIBRARY_KEY, 'usage', asset.id],
    queryFn: () =>
      api.get<Array<{ type: string; id: string; title: string }>>(`/admin/media/${asset.id}/usage`),
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch<MediaAsset>(`/admin/media/${asset.id}`, {
        label: label.trim(),
        alt: alt.trim() ? alt.trim() : null,
      }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/media/${asset.id}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const inUse = (usage.data?.length ?? 0) > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={asset.label}
      description={`${asset.kind === 'VIDEO' ? 'Video' : 'Picture'} · ${asset.width ?? '?'}×${asset.height ?? '?'}${asset.durationSeconds ? ` · ${asset.durationSeconds} s` : ''} · ${sizeText(asset.sizeBytes)}`}
      footer={
        <>
          {confirming ? (
            <>
              <span className="mr-auto self-center text-sm">Delete it for good?</span>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Yes, delete
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={inUse}
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={save.isPending}
                disabled={!label.trim()}
                onClick={() => save.mutate()}
              >
                Save
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-md bg-muted">
          {asset.kind === 'VIDEO' ? (
            // The admin's own check of the file, so player controls are fine here.
            <video
              src={asset.url}
              poster={asset.posterUrl ?? undefined}
              controls
              muted
              playsInline
              preload="none"
              className="aspect-video w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- an operator upload
            <img
              src={asset.url}
              alt={asset.alt ?? ''}
              className="max-h-[50vh] w-full object-contain"
            />
          )}
        </div>
        <ErrorAlert error={save.error ?? remove.error} />
        <Field label="Name" htmlFor="asset-label" hint="Only you see this, to find it again.">
          <Input
            id="asset-label"
            maxLength={120}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="asset-alt"
          hint="The default description wherever it is used, read aloud by screen readers."
        >
          <Input
            id="asset-alt"
            maxLength={160}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
          />
        </Field>
        <div className="text-sm">
          <p className="font-medium">Where it is shown</p>
          {usage.isPending ? (
            <p className="text-muted-foreground">Checking…</p>
          ) : inUse ? (
            <>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {usage.data!.map((use) => (
                  <li key={`${use.type}-${use.id}`}>{use.title}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                To delete it, first choose something else there.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Nowhere on the site yet.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function MediaLibrary() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<MediaKind | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<MediaAsset | null>(null);

  const assets = useQuery({
    queryKey: [...MEDIA_LIBRARY_KEY, kind, search, page],
    queryFn: () =>
      api.get<Paginated<MediaAsset>>(
        `/admin/media?page=${page}&pageSize=24${kind === 'ALL' ? '' : `&kind=${kind}`}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Media library</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Pictures and videos for the home page hero, blog posts, home features and home boxes.
          Pictures are stored in sizes for every screen; videos are optimised for the web, made
          silent, and given a lighter copy for phones. Upload once here, then choose them anywhere.
        </p>
      </header>

      <Card className="mb-6">
        <CardContent className="grid gap-6 p-5 md:grid-cols-2">
          <MediaUploader kind="IMAGE" onUploaded={refresh} size="default" />
          <MediaUploader kind="VIDEO" onUploaded={refresh} size="default" />
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-md border border-border p-0.5"
          role="radiogroup"
          aria-label="Show"
        >
          {(
            [
              ['ALL', 'Everything'],
              ['IMAGE', 'Pictures'],
              ['VIDEO', 'Videos'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => {
                setKind(value);
                setPage(1);
              }}
              className={cn(
                'rounded px-3 py-1.5 text-sm transition-colors',
                kind === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          type="search"
          placeholder="Search by name"
          aria-label="Search the media library"
          className="max-w-xs"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <ErrorAlert error={assets.error} className="mb-4" />
      {assets.isPending ? (
        <Spinner label="Loading the media library" />
      ) : assets.data && assets.data.items.length > 0 ? (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {assets.data.items.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => setOpen(asset)}
                  className="group block w-full overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <MediaThumb
                    kind={asset.kind}
                    source={asset}
                    className="aspect-video w-full rounded-none"
                  />
                  <span className="block px-2.5 pt-2 text-sm font-medium leading-tight">
                    <span className="line-clamp-1">{asset.label}</span>
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 pb-2 pt-1 text-xs text-muted-foreground">
                    <Badge variant="outline">{asset.kind === 'VIDEO' ? 'Video' : 'Picture'}</Badge>
                    {sizeText(asset.sizeBytes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {assets.data.totalPages > 1 ? (
            <div className="mt-6">
              <Pagination
                page={assets.data.page}
                totalPages={assets.data.totalPages}
                onChange={setPage}
              />
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={search ? 'Nothing matches' : 'No media yet'}
          description="Upload a picture or a video above, or from any editor that shows media."
        />
      )}

      {open ? <AssetDialog asset={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

export default function AdminMediaPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <MediaLibrary />
      </div>
    </RequireAuth>
  );
}
