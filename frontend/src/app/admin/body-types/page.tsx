'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Upload } from 'lucide-react';
import {
  BODY_TYPES,
  BODY_TYPE_PLURAL_LABELS,
  type BodyType,
  type BodyTypeImage,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Button, Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { BodyTypeIcon } from '@/components/body-type-icon';
import { AdminImagePreview } from '@/components/admin-image-preview';

/** What the API accepts, so a wrong file is refused here rather than at upload. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 10 * 1024 * 1024;

interface Uploaded {
  url: string;
}

/**
 * The photographs behind the home page's "Browse by body type" row.
 *
 * The row falls back on its own to a drawn silhouette, so nothing here is
 * required. The shortcuts are drawn as icons with nothing behind them, so an
 * upload on a flat backdrop (white, say) has the backdrop cut away by the API
 * when it is uploaded.
 */
function BodyTypeImages() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<BodyType | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const inputs = useRef<Partial<Record<BodyType, HTMLInputElement | null>>>({});

  const images = useQuery({
    queryKey: ['admin-body-type-images'],
    queryFn: () => api.get<BodyTypeImage[]>('/admin/body-type-images'),
  });

  const save = useMutation({
    mutationFn: async ({ bodyType, file }: { bodyType: BodyType; file: File }) => {
      // Two steps on purpose: the bytes go to the upload endpoint, which
      // validates the type and generates the filename, and only the URL it
      // hands back is stored. Nothing the browser names reaches the database.
      const stored = await api.upload<Uploaded>('/uploads/body-type-images', file);
      return api.put<BodyTypeImage>(`/admin/body-type-images/${bodyType}`, {
        imageUrl: stored.url,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-body-type-images'] });
    },
    onSettled: () => setBusy(null),
  });

  const clear = useMutation({
    mutationFn: (bodyType: BodyType) => api.delete(`/admin/body-type-images/${bodyType}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-body-type-images'] });
    },
    onSettled: () => setBusy(null),
  });

  function choose(bodyType: BodyType, file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setFailure(
        new Error(`${file.name} is a ${file.type || 'unknown type'}. Use JPEG, PNG, WebP or AVIF.`),
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      setFailure(
        new Error(
          `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`,
        ),
      );
      return;
    }
    setFailure(null);
    setBusy(bodyType);
    save.mutate({ bodyType, file });
  }

  const byType = new Map((images.data ?? []).map((entry) => [entry.bodyType, entry]));

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Body type icons</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The icons on the home page&rsquo;s <strong>Browse by body type</strong> row, drawn with no
          box or background behind them. A body type with no image here shows a drawn outline
          instead. Upload a car on a plain white or single-colour background and the background is
          removed automatically; a transparent PNG is used as it is. Cars facing the same direction
          make the row read as a set.
        </p>
      </header>

      {failure ? <ErrorAlert error={failure} className="mb-4" /> : null}
      {save.error ? <ErrorAlert error={save.error} className="mb-4" /> : null}
      {clear.error ? <ErrorAlert error={clear.error} className="mb-4" /> : null}
      {images.error ? <ErrorAlert error={images.error} className="mb-4" /> : null}

      {images.isLoading ? (
        <Spinner label="Loading body type photos" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BODY_TYPES.map((bodyType) => {
            const current = byType.get(bodyType);
            const working = busy === bodyType;

            return (
              <li key={bodyType}>
                <Card>
                  <CardContent className="p-4">
                    <div className="mb-3 flex items-baseline justify-between gap-2">
                      <h2 className="font-semibold">{BODY_TYPE_PLURAL_LABELS[bodyType]}</h2>
                      <span className="text-xs text-muted-foreground">
                        {current?.imageUrl ? 'Custom photo' : 'Using the fallback'}
                      </span>
                    </div>

                    <div className="mb-3 grid aspect-[3/2] w-full place-items-center overflow-hidden rounded-md border border-border bg-white">
                      {current?.imageUrl ? (
                        <AdminImagePreview
                          src={current.imageUrl}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <BodyTypeIcon bodyType={bodyType} className="h-14 w-auto text-slate-400" />
                      )}
                    </div>

                    <input
                      ref={(element) => {
                        inputs.current[bodyType] = element;
                      }}
                      type="file"
                      accept={ACCEPTED.join(',')}
                      className="sr-only"
                      onChange={(event) => {
                        choose(bodyType, event.target.files?.[0]);
                        // Cleared so picking the same file twice fires again,
                        // which is what someone does after a failed upload.
                        event.target.value = '';
                      }}
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        loading={working && save.isPending}
                        onClick={() => inputs.current[bodyType]?.click()}
                      >
                        <Upload className="mr-1.5 h-4 w-4" aria-hidden />
                        {current?.imageUrl ? 'Replace photo' : 'Upload photo'}
                      </Button>
                      {current?.imageUrl ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={working && clear.isPending}
                          onClick={() => {
                            setBusy(bodyType);
                            clear.mutate(bodyType);
                          }}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function AdminBodyTypesPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <BodyTypeImages />
      </div>
    </RequireAuth>
  );
}
