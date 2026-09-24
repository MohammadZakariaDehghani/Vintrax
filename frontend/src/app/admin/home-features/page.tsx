'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  HOME_FEATURE_BUTTON_PLACEMENTS,
  HOME_FEATURE_BUTTON_PLACEMENT_LABELS,
  normalizeFooterHref,
  type HomeFeature,
  type HomeFeatureButtonPlacement,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { HomeFeatureBlock } from '@/components/home-features';

interface Draft {
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
  buttonLabel: string;
  buttonUrl: string;
  buttonPlacement: HomeFeatureButtonPlacement;
  enabled: boolean;
}

const EMPTY: Draft = {
  title: '',
  body: '',
  imageUrl: '',
  imageAlt: '',
  buttonLabel: '',
  buttonUrl: '',
  buttonPlacement: 'TEXT_LEFT',
  enabled: true,
};

function draftFrom(feature: HomeFeature): Draft {
  return {
    title: feature.title,
    body: feature.body ?? '',
    imageUrl: feature.imageUrl ?? '',
    imageAlt: feature.imageAlt ?? '',
    buttonLabel: feature.buttonLabel ?? '',
    buttonUrl: feature.buttonUrl ?? '',
    buttonPlacement: feature.buttonPlacement,
    enabled: feature.enabled,
  };
}

/** Blank fields go as null, so clearing one removes it. */
function payloadFrom(draft: Draft) {
  const orNull = (value: string) => (value.trim() ? value.trim() : null);
  return {
    title: draft.title.trim(),
    body: orNull(draft.body),
    imageUrl: orNull(draft.imageUrl),
    imageAlt: orNull(draft.imageAlt),
    buttonLabel: orNull(draft.buttonLabel),
    buttonUrl: orNull(draft.buttonUrl),
    buttonPlacement: draft.buttonPlacement,
    enabled: draft.enabled,
  };
}

/**
 * Writing one block, with the real home page component as the preview, so
 * what the administrator signs off on is what visitors see.
 */
function FeatureEditor({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial: Draft;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
  saving: boolean;
  error: unknown;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const upload = useMutation({
    mutationFn: (file: File) => api.upload<{ url: string }>('/uploads/home-features', file),
    onSuccess: (stored) => set('imageUrl', stored.url),
  });

  const buttonHalf = Boolean(draft.buttonLabel.trim()) !== Boolean(draft.buttonUrl.trim());
  const canSave = draft.title.trim().length > 0 && !buttonHalf;

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div>
          <p className="mb-2 text-sm font-semibold">Preview</p>
          <HomeFeatureBlock
            feature={{
              id: 'preview',
              ...payloadFrom(draft),
              title: draft.title.trim() || 'Your title',
              buttonUrl: draft.buttonUrl.trim() ? normalizeFooterHref(draft.buttonUrl) : null,
              position: 0,
              updatedAt: new Date().toISOString(),
            }}
          />
        </div>

        <ErrorAlert error={upload.error ?? error} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="feature-title" className="sm:col-span-2">
            <Input
              id="feature-title"
              maxLength={140}
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field
            label="Text"
            htmlFor="feature-body"
            hint="Optional. Leave a blank line between paragraphs."
            className="sm:col-span-2"
          >
            <Textarea
              id="feature-body"
              rows={4}
              maxLength={2000}
              value={draft.body}
              onChange={(e) => set('body', e.target.value)}
            />
          </Field>
          <Field
            label="Photo"
            htmlFor="feature-image"
            hint="Optional. A landscape photo works best."
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                id="feature-image"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                className="sr-only"
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
                {draft.imageUrl ? 'Replace photo' : 'Upload photo'}
              </Button>
              {draft.imageUrl ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => set('imageUrl', '')}>
                  Remove
                </Button>
              ) : null}
            </div>
          </Field>
          <Field
            label="Photo description"
            htmlFor="feature-alt"
            hint="Optional. Read aloud by screen readers."
          >
            <Input
              id="feature-alt"
              maxLength={160}
              value={draft.imageAlt}
              onChange={(e) => set('imageAlt', e.target.value)}
            />
          </Field>
          <Field label="Button text" htmlFor="feature-button-label" hint="Optional.">
            <Input
              id="feature-button-label"
              maxLength={40}
              placeholder="Visit the website"
              value={draft.buttonLabel}
              onChange={(e) => set('buttonLabel', e.target.value)}
            />
          </Field>
          <Field
            label="Button link"
            htmlFor="feature-button-url"
            hint={
              draft.buttonUrl.trim() &&
              normalizeFooterHref(draft.buttonUrl) !== draft.buttonUrl.trim()
                ? `Saved as ${normalizeFooterHref(draft.buttonUrl)}`
                : 'A website such as example.com, or a page here starting with /.'
            }
          >
            <Input
              id="feature-button-url"
              maxLength={500}
              placeholder="example.com/offer"
              value={draft.buttonUrl}
              onChange={(e) => set('buttonUrl', e.target.value)}
            />
          </Field>
          <Field label="Where the button goes" htmlFor="feature-button-placement">
            <Select
              id="feature-button-placement"
              value={draft.buttonPlacement}
              onChange={(e) => set('buttonPlacement', e.target.value as HomeFeatureButtonPlacement)}
            >
              {HOME_FEATURE_BUTTON_PLACEMENTS.map((placement) => (
                <option key={placement} value={placement}>
                  {HOME_FEATURE_BUTTON_PLACEMENT_LABELS[placement]}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={draft.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            Show on the home page
          </label>
        </div>

        {buttonHalf ? (
          <p className="text-sm text-destructive">
            Give the button both a text and a link, or leave both blank.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" loading={saving} disabled={!canSave} onClick={() => onSave(draft)}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HomeFeaturesAdmin() {
  const queryClient = useQueryClient();
  // `new` for the create form, an id for an open editor, null for neither.
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const features = useQuery({
    queryKey: ['admin-home-features'],
    queryFn: () => api.get<HomeFeature[]>('/admin/home-features'),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-home-features'] });

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: string | null; draft: Draft }) =>
      id
        ? api.patch<HomeFeature>(`/admin/home-features/${id}`, payloadFrom(draft))
        : api.post<HomeFeature>('/admin/home-features', payloadFrom(draft)),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });

  const toggle = useMutation({
    mutationFn: (feature: HomeFeature) =>
      api.patch(`/admin/home-features/${feature.id}`, { enabled: !feature.enabled }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/home-features/${id}`),
    onSuccess: () => {
      setConfirmingDelete(null);
      refresh();
    },
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put<HomeFeature[]>('/admin/home-features/order', { ids }),
    onSuccess: (result) => queryClient.setQueryData(['admin-home-features'], result),
  });

  function move(index: number, by: -1 | 1) {
    const ids = (features.data ?? []).map((feature) => feature.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  }

  if (features.isPending) return <Spinner label="Loading the home features" />;
  const items = features.data ?? [];

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Home features</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Blocks on the home page under <strong>Recently listed</strong>, one under another in the
            order below. Each can have a photo, some text and a button to a website or a page here.
            They are separate from the blog and appear nowhere else.
          </p>
        </div>
        {editing !== 'new' ? (
          <Button
            onClick={() => {
              save.reset();
              setEditing('new');
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Add a block
          </Button>
        ) : null}
      </header>

      <ErrorAlert
        error={features.error ?? toggle.error ?? remove.error ?? reorder.error}
        className="mb-4"
      />

      {editing === 'new' ? (
        <div className="mb-6">
          <FeatureEditor
            initial={EMPTY}
            saving={save.isPending}
            error={save.error}
            onSave={(draft) => save.mutate({ id: null, draft })}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : null}

      {items.length === 0 && editing !== 'new' ? (
        <EmptyState
          title="No feature blocks yet"
          description="Add one and it appears on the home page under Recently listed."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((feature, index) =>
            editing === feature.id ? (
              <li key={feature.id}>
                <FeatureEditor
                  initial={draftFrom(feature)}
                  saving={save.isPending}
                  error={save.error}
                  onSave={(draft) => save.mutate({ id: feature.id, draft })}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={feature.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-4 p-4">
                    <div className="h-16 w-28 shrink-0 overflow-hidden rounded bg-muted">
                      {feature.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={feature.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant={feature.enabled ? 'success' : 'outline'}>
                          {feature.enabled ? 'Shown' : 'Hidden'}
                        </Badge>
                        {feature.buttonLabel ? (
                          <Badge variant="outline">
                            Button: {HOME_FEATURE_BUTTON_PLACEMENT_LABELS[feature.buttonPlacement]}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="font-semibold">{feature.title}</p>
                      {feature.buttonUrl ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {feature.buttonUrl}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${feature.title} up`}
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${feature.title} down`}
                        disabled={index === items.length - 1 || reorder.isPending}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={
                          feature.enabled ? `Hide ${feature.title}` : `Show ${feature.title}`
                        }
                        onClick={() => toggle.mutate(feature)}
                      >
                        {feature.enabled ? (
                          <EyeOff className="h-4 w-4" aria-hidden />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          save.reset();
                          setEditing(feature.id);
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                        Edit
                      </Button>
                      {confirmingDelete === feature.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            loading={remove.isPending}
                            onClick={() => remove.mutate(feature.id)}
                          >
                            Yes, delete
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmingDelete(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${feature.title}`}
                          onClick={() => setConfirmingDelete(feature.id)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ),
          )}
        </ol>
      )}
    </>
  );
}

export default function AdminHomeFeaturesPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <HomeFeaturesAdmin />
      </div>
    </RequireAuth>
  );
}
