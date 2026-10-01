'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  HOME_FEATURE_BUTTON_PLACEMENTS,
  HOME_FEATURE_BUTTON_PLACEMENT_LABELS,
  HOME_FEATURE_LAYOUTS,
  HOME_FEATURE_LAYOUT_LABELS,
  homeFeatureMedia,
  normalizeFooterHref,
  type HomeFeature,
  type HomeFeatureButtonPlacement,
  type HomeFeatureLayout,
  type MediaPresentation,
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
import { MediaEditor } from '@/components/media/admin/media-editor';
import { MediaThumb } from '@/components/media/admin/media-thumb';
import { LivePreview } from '@/components/media/admin/live-preview';
import { toMediaInput } from '@/lib/media-input';

interface Draft {
  title: string;
  subtitle: string;
  body: string;
  /** The picture or video — a block saved before the library shows its photo here. */
  media: MediaPresentation | null;
  layout: HomeFeatureLayout;
  buttonLabel: string;
  buttonUrl: string;
  buttonPlacement: HomeFeatureButtonPlacement;
  enabled: boolean;
}

const EMPTY: Draft = {
  title: '',
  subtitle: '',
  body: '',
  media: null,
  layout: 'SPLIT',
  buttonLabel: '',
  buttonUrl: '',
  buttonPlacement: 'TEXT_LEFT',
  enabled: true,
};

function draftFrom(feature: HomeFeature): Draft {
  return {
    title: feature.title,
    subtitle: feature.subtitle ?? '',
    body: feature.body ?? '',
    media: homeFeatureMedia(feature),
    layout: feature.layout,
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
    subtitle: orNull(draft.subtitle),
    body: orNull(draft.body),
    media: toMediaInput(draft.media),
    layout: draft.layout,
    // Removing the media removes the photo a block was saved with before
    // the library too; otherwise that photo would quietly come back.
    ...(draft.media ? {} : { imageUrl: null, imageAlt: null }),
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
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const buttonHalf = Boolean(draft.buttonLabel.trim()) !== Boolean(draft.buttonUrl.trim());
  const canSave = draft.title.trim().length > 0 && !buttonHalf;

  // What the preview frames draw: the real home page block, unsaved.
  const preview = useMemo(
    () => ({
      kind: 'feature' as const,
      feature: {
        id: 'preview',
        title: draft.title.trim() || 'Your title',
        subtitle: draft.subtitle.trim() || null,
        body: draft.body.trim() || null,
        imageUrl: null,
        imageAlt: null,
        media: draft.media,
        layout: draft.layout,
        buttonLabel: draft.buttonLabel.trim() || null,
        buttonUrl: draft.buttonUrl.trim() ? normalizeFooterHref(draft.buttonUrl) : null,
        buttonPlacement: draft.buttonPlacement,
        position: 0,
        enabled: draft.enabled,
        updatedAt: new Date().toISOString(),
      },
    }),
    [draft],
  );

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div>
          <p className="mb-2 text-sm font-semibold">Preview</p>
          <LivePreview payload={preview} />
        </div>

        <ErrorAlert error={error} />

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
            label="Line above the text"
            htmlFor="feature-subtitle"
            hint="Optional. A short heading over the text, e.g. “New this month”."
            className="sm:col-span-2"
          >
            <Input
              id="feature-subtitle"
              maxLength={180}
              value={draft.subtitle}
              onChange={(e) => set('subtitle', e.target.value)}
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
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium">Picture or video</p>
            <MediaEditor
              idPrefix="feature"
              value={draft.media}
              onChange={(media) => set('media', media)}
            />
          </div>
          <Field
            label="Layout"
            htmlFor="feature-layout"
            hint="Full width suits a wide picture or video: the words sit over it."
          >
            <Select
              id="feature-layout"
              value={draft.layout}
              onChange={(e) => set('layout', e.target.value as HomeFeatureLayout)}
            >
              {HOME_FEATURE_LAYOUTS.map((layout) => (
                <option key={layout} value={layout}>
                  {HOME_FEATURE_LAYOUT_LABELS[layout]}
                </option>
              ))}
            </Select>
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
          <Field
            label="Status"
            htmlFor="feature-status"
            hint="A draft is saved and previewed here, not shown on the site."
          >
            <Select
              id="feature-status"
              value={draft.enabled ? 'ACTIVE' : 'DRAFT'}
              onChange={(e) => set('enabled', e.target.value === 'ACTIVE')}
            >
              <option value="ACTIVE">Active — on the home page</option>
              <option value="DRAFT">Draft — hidden</option>
            </Select>
          </Field>
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
            order below. Each can have a picture or a silent video, some text and a button to a
            website or a page here — beside the media, or over it at full width. Use the arrows to
            reorder. They are separate from the blog and appear nowhere else.
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
                    <MediaThumb
                      kind={homeFeatureMedia(feature)?.kind ?? 'IMAGE'}
                      source={homeFeatureMedia(feature)?.desktop ?? null}
                      className="h-16 w-28 shrink-0"
                    />
                    <div className="min-w-[200px] flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant={feature.enabled ? 'success' : 'outline'}>
                          {feature.enabled ? 'Active' : 'Draft'}
                        </Badge>
                        {feature.layout === 'FULL_BLEED' ? (
                          <Badge variant="outline">Full width</Badge>
                        ) : null}
                        {homeFeatureMedia(feature)?.kind === 'VIDEO' ? (
                          <Badge variant="outline">Video</Badge>
                        ) : null}
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
