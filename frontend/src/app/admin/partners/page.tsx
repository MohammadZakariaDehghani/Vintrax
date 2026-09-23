'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import type { Partner } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Button, Card, CardContent, ErrorAlert, Input, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { AdminImagePreview } from '@/components/admin-image-preview';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 10 * 1024 * 1024;

interface Uploaded {
  url: string;
}

/**
 * The logos in the home page's "Our Partners" carousel (issue #67).
 *
 * Unlike make logos and body-type photos, a partner has no independent
 * existence elsewhere in the app — the row created here is the whole record
 * — so this screen has an explicit "Add partner" action, and each row can be
 * disabled without deleting it: the homepage carousel only ever draws the
 * enabled ones.
 */
function Partners() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [newName, setNewName] = useState('');
  const newFileInput = useRef<HTMLInputElement | null>(null);
  const editFileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const partners = useQuery({
    queryKey: ['admin-partners'],
    queryFn: () => api.get<Partner[]>('/admin/partners'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-partners'] });

  const create = useMutation({
    mutationFn: async ({ name, file }: { name: string; file: File }) => {
      const stored = await api.upload<Uploaded>('/uploads/partners', file);
      return api.post<Partner>('/admin/partners', { name, logoUrl: stored.url });
    },
    onSuccess: () => {
      setNewName('');
      void invalidate();
    },
    onSettled: () => setBusyId(null),
  });

  const replaceLogo = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const stored = await api.upload<Uploaded>('/uploads/partners', file);
      return api.put<Partner>(`/admin/partners/${id}`, { logoUrl: stored.url });
    },
    onSuccess: () => void invalidate(),
    onSettled: () => setBusyId(null),
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.put<Partner>(`/admin/partners/${id}`, { enabled }),
    onSuccess: () => void invalidate(),
    onSettled: () => setBusyId(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/partners/${id}`),
    onSuccess: () => void invalidate(),
    onSettled: () => setBusyId(null),
  });

  function validate(file: File): boolean {
    if (!ACCEPTED.includes(file.type)) {
      setFailure(
        new Error(`${file.name} is a ${file.type || 'unknown type'}. Use JPEG, PNG, WebP or AVIF.`),
      );
      return false;
    }
    if (file.size > MAX_BYTES) {
      setFailure(
        new Error(
          `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`,
        ),
      );
      return false;
    }
    setFailure(null);
    return true;
  }

  function addPartner(file: File | undefined) {
    if (!file || !validate(file)) return;
    if (newName.trim().length === 0) {
      setFailure(new Error('Give the partner a name before uploading its logo.'));
      return;
    }
    setBusyId('new');
    create.mutate({ name: newName.trim(), file });
  }

  function chooseReplacement(id: string, file: File | undefined) {
    if (!file || !validate(file)) return;
    setBusyId(id);
    replaceLogo.mutate({ id, file });
  }

  if (partners.isPending) return <Spinner label="Loading partners" />;

  const rows = partners.data ?? [];

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Partners</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Logos shown in the &ldquo;Our Partners&rdquo; carousel on the home page. Only enabled
          partners appear there; disabling one keeps it here to turn back on later.
        </p>
      </header>

      {failure ? <ErrorAlert error={failure} className="mb-4" /> : null}
      {create.error ? <ErrorAlert error={create.error} className="mb-4" /> : null}
      {replaceLogo.error ? <ErrorAlert error={replaceLogo.error} className="mb-4" /> : null}
      {toggleEnabled.error ? <ErrorAlert error={toggleEnabled.error} className="mb-4" /> : null}
      {remove.error ? <ErrorAlert error={remove.error} className="mb-4" /> : null}
      {partners.error ? <ErrorAlert error={partners.error} className="mb-4" /> : null}

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1 basis-56">
            <label htmlFor="new-partner-name" className="mb-1 block text-sm font-medium">
              Partner name
            </label>
            <Input
              id="new-partner-name"
              placeholder="e.g. Acme Insurance"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <input
            ref={newFileInput}
            type="file"
            accept={ACCEPTED.join(',')}
            className="sr-only"
            onChange={(event) => {
              addPartner(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button
            loading={busyId === 'new' && create.isPending}
            onClick={() => newFileInput.current?.click()}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Add partner
          </Button>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No partners added yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((partner) => {
            const working = busyId === partner.id;

            return (
              <li key={partner.id}>
                <Card>
                  <CardContent className="p-4">
                    <div className="mb-3 flex items-baseline justify-between gap-2">
                      <h2 className="font-semibold">{partner.name}</h2>
                      <span className="text-xs text-muted-foreground">
                        {partner.enabled ? 'Shown on home page' : 'Hidden'}
                      </span>
                    </div>

                    <div className="mb-3 grid aspect-[3/2] w-full place-items-center overflow-hidden rounded-md border border-border bg-white">
                      <AdminImagePreview
                        src={partner.logoUrl}
                        alt={partner.alt ?? ''}
                        className="h-full w-full object-contain"
                      />
                    </div>

                    <input
                      ref={(element) => {
                        editFileInputs.current[partner.id] = element;
                      }}
                      type="file"
                      accept={ACCEPTED.join(',')}
                      className="sr-only"
                      onChange={(event) => {
                        chooseReplacement(partner.id, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        loading={working && replaceLogo.isPending}
                        onClick={() => editFileInputs.current[partner.id]?.click()}
                      >
                        <Upload className="mr-1.5 h-4 w-4" aria-hidden />
                        Replace logo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={working && toggleEnabled.isPending}
                        onClick={() => {
                          setBusyId(partner.id);
                          toggleEnabled.mutate({ id: partner.id, enabled: !partner.enabled });
                        }}
                      >
                        {partner.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={working && remove.isPending}
                        onClick={() => {
                          setBusyId(partner.id);
                          remove.mutate(partner.id);
                        }}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                        Delete
                      </Button>
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

export default function AdminPartnersPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <Partners />
      </div>
    </RequireAuth>
  );
}
