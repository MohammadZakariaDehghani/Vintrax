'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MediaAsset, MediaKind, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Dialog, EmptyState, ErrorAlert, Input, Pagination, Spinner } from '@/components/ui';
import { MediaThumb } from './media-thumb';
import { MediaUploader } from './media-uploader';

export const MEDIA_LIBRARY_KEY = ['admin-media'] as const;

/**
 * Choosing a picture or video from the media library — or adding a new one
 * from here, which is chosen at once — for whatever is being edited.
 */
export function MediaLibraryPicker({
  open,
  kind,
  onClose,
  onSelect,
}: {
  open: boolean;
  kind: MediaKind;
  onClose: () => void;
  onSelect: (asset: MediaAsset) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const assets = useQuery({
    queryKey: [...MEDIA_LIBRARY_KEY, kind, search, page],
    queryFn: () =>
      api.get<Paginated<MediaAsset>>(
        `/admin/media?kind=${kind}&page=${page}&pageSize=18${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      ),
    enabled: open,
  });

  const choose = (asset: MediaAsset) => {
    onSelect(asset);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={kind === 'IMAGE' ? 'Choose a picture' : 'Choose a video'}
      description="From the media library, or upload a new one — it is added to the library and chosen."
    >
      <div className="flex flex-col gap-4">
        <MediaUploader
          kind={kind}
          onUploaded={(asset) => {
            void queryClient.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
            choose(asset);
          }}
        />
        <Input
          type="search"
          placeholder="Search by name"
          aria-label="Search the media library"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <ErrorAlert error={assets.error} />
        {assets.isPending ? (
          <Spinner label="Loading the media library" />
        ) : assets.data && assets.data.items.length > 0 ? (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {assets.data.items.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    onClick={() => choose(asset)}
                    className={cn(
                      'group block w-full overflow-hidden rounded-md border border-border text-left transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    )}
                  >
                    <MediaThumb
                      kind={asset.kind}
                      source={asset}
                      className="aspect-video w-full rounded-none"
                    />
                    <span className="block truncate px-2 py-1.5 text-xs font-medium">
                      {asset.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {assets.data.totalPages > 1 ? (
              <Pagination
                page={assets.data.page}
                totalPages={assets.data.totalPages}
                onChange={setPage}
              />
            ) : null}
          </>
        ) : (
          <EmptyState
            title={search ? 'Nothing matches' : 'The library is empty'}
            description={kind === 'IMAGE' ? 'Upload a picture above.' : 'Upload a video above.'}
          />
        )}
      </div>
    </Dialog>
  );
}
