'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Upload } from 'lucide-react';
import type { MakeLogo, VehicleSearchResponse } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { buildMakeLogoRows } from '@/lib/make-logo-rows';
import { Button, Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { BrandLogo } from '@/components/brand-logo';

/** What the API accepts, so a wrong file is refused here rather than at upload. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 10 * 1024 * 1024;

interface Uploaded {
  url: string;
}

/**
 * The logos behind the home page's "Popular makes" row.
 *
 * The row draws a mark for every make on its own — the maker's own trademark
 * where Vintrax has one on file, a lettermark otherwise — so nothing here is
 * required. This exists for the case that generated mark is wrong, missing,
 * or simply not what the business wants shown for a particular make.
 *
 * Unlike the body-type photos, there is no fixed set of makes to list: the
 * row is driven by what is actually in stock, so this screen is too — plus
 * any make an administrator has already set a logo for, so a logo does not
 * become unreachable the moment that make's inventory sells through.
 */
function MakeLogos() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const logos = useQuery({
    queryKey: ['admin-make-logos'],
    queryFn: () => api.get<MakeLogo[]>('/admin/make-logos'),
  });

  // A minimal search, just for its facet counts — the same aggregate the home
  // page's row itself reads, so this screen lists exactly what a visitor
  // would see.
  const facets = useQuery({
    queryKey: ['admin-make-logos-facets'],
    queryFn: () => api.get<VehicleSearchResponse>('/vehicles?pageSize=1'),
  });

  const save = useMutation({
    mutationFn: async ({ make, file }: { make: string; file: File }) => {
      // Two steps on purpose, the same as the body-type photos: the bytes go
      // to the upload endpoint, which validates the type and generates the
      // filename, and only the URL it hands back is stored.
      const stored = await api.upload<Uploaded>('/uploads/make-logos', file);
      return api.put<MakeLogo>(`/admin/make-logos/${encodeURIComponent(make)}`, {
        imageUrl: stored.url,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-make-logos'] });
    },
    onSettled: () => setBusy(null),
  });

  const clear = useMutation({
    mutationFn: (make: string) => api.delete(`/admin/make-logos/${encodeURIComponent(make)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-make-logos'] });
    },
    onSettled: () => setBusy(null),
  });

  function choose(make: string, file: File | undefined) {
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
    setBusy(make);
    save.mutate({ make, file });
  }

  if (logos.isPending || facets.isPending) return <Spinner label="Loading make logos" />;

  const rows = buildMakeLogoRows({
    curated: logos.data ?? [],
    facetMakes: facets.data?.facets.makes ?? [],
  });

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Make logos</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Overrides the generated mark the home page&rsquo;s <strong>Popular makes</strong> row
          otherwise draws for a make. Listed here: every make currently in stock, plus any make
          with a logo already set.
        </p>
      </header>

      {failure ? <ErrorAlert error={failure} className="mb-4" /> : null}
      {save.error ? <ErrorAlert error={save.error} className="mb-4" /> : null}
      {clear.error ? <ErrorAlert error={clear.error} className="mb-4" /> : null}
      {logos.error ? <ErrorAlert error={logos.error} className="mb-4" /> : null}
      {facets.error ? <ErrorAlert error={facets.error} className="mb-4" /> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in stock yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const working = busy === row.make;

            return (
              <li key={row.make}>
                <Card>
                  <CardContent className="p-4">
                    <div className="mb-3 flex items-baseline justify-between gap-2">
                      <h2 className="font-semibold">{row.make}</h2>
                      <span className="text-xs text-muted-foreground">
                        {row.imageUrl ? 'Custom logo' : 'Using the generated mark'}
                      </span>
                    </div>

                    <div className="mb-3 grid aspect-[3/2] w-full place-items-center overflow-hidden rounded-md border border-border bg-white">
                      {row.imageUrl ? (
                        // Same-origin uploads, often already sized for this
                        // row; next/image optimisation adds a hop without a
                        // benefit.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.imageUrl} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <BrandLogo make={row.make} className="h-14 w-14 text-slate-400" />
                      )}
                    </div>

                    <input
                      ref={(element) => {
                        inputs.current[row.make] = element;
                      }}
                      type="file"
                      accept={ACCEPTED.join(',')}
                      className="sr-only"
                      onChange={(event) => {
                        choose(row.make, event.target.files?.[0]);
                        // Cleared so picking the same file twice fires again,
                        // which is what someone does after a failed upload.
                        event.target.value = '';
                      }}
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        loading={working && save.isPending}
                        onClick={() => inputs.current[row.make]?.click()}
                      >
                        <Upload className="mr-1.5 h-4 w-4" aria-hidden />
                        {row.imageUrl ? 'Replace logo' : 'Upload logo'}
                      </Button>
                      {row.imageUrl ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={working && clear.isPending}
                          onClick={() => {
                            setBusy(row.make);
                            clear.mutate(row.make);
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

export default function AdminMakeLogosPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <MakeLogos />
      </div>
    </RequireAuth>
  );
}
