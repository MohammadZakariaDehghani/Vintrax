'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ImageDown, Loader2 } from 'lucide-react';
import type { InventoryImportRecord, InventoryPhotoProgress, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui';
import { cn } from '@/lib/utils';

const RUNNING: ReadonlyArray<InventoryPhotoProgress['status']> = ['PENDING', 'RUNNING'];

const STATUS_LABEL: Record<InventoryPhotoProgress['status'], string> = {
  NOT_REQUESTED: 'Photos not requested',
  PENDING: 'Photos waiting to start',
  RUNNING: 'Downloading photos',
  COMPLETED: 'Photos done',
  COMPLETED_WITH_ERRORS: 'Photos done, some not downloaded',
  FAILED: 'Photo download stopped',
};

/**
 * What happened to an import's photos: how many were copied, how many were
 * already held, how many could not be downloaded, and why. The reasons are
 * recorded by host — "photos.example.ca: the server answered HTTP 403" — so a
 * dealer, or whoever runs their feed, can see what to fix.
 */
export function PhotoProgress({ photos }: { photos: InventoryPhotoProgress }) {
  if (photos.status === 'NOT_REQUESTED') {
    return <p className="text-sm text-muted-foreground">{STATUS_LABEL.NOT_REQUESTED}.</p>;
  }
  const done = photos.fetched + photos.reused + photos.failed;
  const percent =
    photos.expected > 0 ? Math.min(100, Math.round((done / photos.expected) * 100)) : 0;
  const running = RUNNING.includes(photos.status);
  const Icon = running
    ? Loader2
    : photos.status === 'COMPLETED'
      ? CheckCircle2
      : photos.status === 'FAILED' || photos.failed > 0 || photos.errors.length > 0
        ? AlertTriangle
        : CheckCircle2;

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon
          className={cn(
            'h-4 w-4',
            running && 'animate-spin',
            photos.status === 'COMPLETED' && 'text-success',
            (photos.status === 'FAILED' || photos.status === 'COMPLETED_WITH_ERRORS') &&
              'text-warning',
          )}
          aria-hidden
        />
        {STATUS_LABEL[photos.status]}
      </p>
      {photos.expected > 0 ? (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Photo download progress"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {photos.fetched} downloaded · {photos.reused} already copied · {photos.failed} could not be
        downloaded
        {photos.expected > 0 ? ` · ${photos.expected} in the file` : ''}
      </p>
      {photos.errors.length > 0 ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
          <p className="font-medium">Why some photos are missing</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {photos.errors.map((error) => (
              <li key={error} className="break-words">
                {error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Live progress for the import just applied, refreshed until the photos finish. */
export function ImportPhotoStatus({ importId }: { importId: string }) {
  const record = useQuery({
    queryKey: ['inventory-import', importId],
    queryFn: () => api.get<InventoryImportRecord>(`/dealer/inventory/imports/${importId}`),
    refetchInterval: (query) =>
      query.state.data && !RUNNING.includes(query.state.data.photos.status) ? false : 3000,
  });
  if (!record.data) return null;
  return (
    <div className="mt-4 rounded-md border border-border p-4">
      <PhotoProgress photos={record.data.photos} />
    </div>
  );
}

/**
 * The dealer's last few imports, each with what happened to its photos — so
 * an import run yesterday that left listings without pictures says why.
 */
export function RecentImports() {
  const imports = useQuery({
    queryKey: ['inventory-imports'],
    queryFn: () =>
      api.get<Paginated<InventoryImportRecord>>('/dealer/inventory/imports?page=1&pageSize=5'),
    refetchInterval: (query) =>
      query.state.data?.items.some((entry) => RUNNING.includes(entry.photos.status)) ? 5000 : false,
  });
  const items = imports.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <Card className="mt-5">
      <CardContent className="pt-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <ImageDown className="h-4 w-4" aria-hidden />
          Recent imports
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {items.map((entry) => (
            <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-medium">
                {entry.filename}{' '}
                <span className="font-normal text-muted-foreground">
                  ·{' '}
                  {new Date(entry.createdAt).toLocaleString('en-CA', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}{' '}
                  · {entry.createdCount} created, {entry.updatedCount} updated
                </span>
              </p>
              <div className="mt-2">
                <PhotoProgress photos={entry.photos} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
