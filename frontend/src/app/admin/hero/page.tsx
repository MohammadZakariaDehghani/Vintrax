'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HOME_HERO_HEIGHTS,
  HOME_HERO_HEIGHT_LABELS,
  HOME_HERO_OVERLAY,
  normalizeFooterHref,
  type HomeHero,
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
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { MediaEditor } from '@/components/media/admin/media-editor';
import { LivePreview } from '@/components/media/admin/live-preview';

const orNull = (value: string | null) => (value?.trim() ? value.trim() : null);

/** A link field's hint: what a pasted address will be saved as. */
function linkHint(value: string | null): string {
  return value?.trim() && normalizeFooterHref(value) !== value.trim()
    ? `Saved as ${normalizeFooterHref(value)}`
    : 'A page here starting with /, or a website such as example.com.';
}

function payloadFrom(hero: HomeHero, enabled: boolean) {
  return {
    title: hero.title.trim(),
    subtitle: orNull(hero.subtitle),
    primaryCtaLabel: orNull(hero.primaryCtaLabel),
    primaryCtaUrl: orNull(hero.primaryCtaUrl),
    secondaryCtaLabel: orNull(hero.secondaryCtaLabel),
    secondaryCtaUrl: orNull(hero.secondaryCtaUrl),
    overlayOpacity: hero.overlayOpacity,
    align: hero.align,
    height: hero.height,
    media: toMediaInput(hero.media),
    enabled,
  };
}

function HeroEditor() {
  const queryClient = useQueryClient();
  const saved = useQuery({
    queryKey: ['admin-home-hero'],
    queryFn: () => api.get<HomeHero>('/admin/home-hero'),
  });
  const [draft, setDraft] = useState<HomeHero | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (saved.data && !draft) setDraft(saved.data);
  }, [saved.data, draft]);

  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      api.put<HomeHero>('/admin/home-hero', payloadFrom(draft!, enabled)),
    onSuccess: (result) => {
      setDraft(result);
      queryClient.setQueryData(['admin-home-hero'], result);
      setNotice(
        result.enabled
          ? 'Saved and live: the hero now heads the home page.'
          : 'Saved as a draft: the home page still leads with the newest blog posts.',
      );
    },
  });

  const preview = useMemo(() => (draft ? { kind: 'hero' as const, hero: draft } : null), [draft]);

  if (saved.isPending || (saved.data && !draft)) return <Spinner label="Loading the hero" />;
  if (!draft) return <ErrorAlert error={saved.error} />;

  const set = <K extends keyof HomeHero>(key: K, value: HomeHero[K]) => {
    setNotice(null);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };
  const halfButton = (label: string | null, url: string | null) =>
    Boolean(label?.trim()) !== Boolean(url?.trim());
  const invalid =
    !draft.title.trim() ||
    halfButton(draft.primaryCtaLabel, draft.primaryCtaUrl) ||
    halfButton(draft.secondaryCtaLabel, draft.secondaryCtaUrl);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
            Home page hero
            <Badge variant={saved.data?.enabled ? 'success' : 'outline'}>
              {saved.data?.enabled ? 'Active' : 'Draft'}
            </Badge>
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            A full-width picture or silent looping video at the top of the home page, with a
            headline and buttons over it. While it is active it takes the place of the blog
            slideshow there; the newest posts still appear just below. As a draft it is saved and
            previewed here only.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>
            With your unsaved changes, at a computer&apos;s and a phone&apos;s width.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LivePreview payload={preview} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Words and buttons</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Headline" htmlFor="hero-title" className="sm:col-span-2">
              <Input
                id="hero-title"
                maxLength={120}
                value={draft.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </Field>
            <Field label="Line under it" htmlFor="hero-subtitle" className="sm:col-span-2">
              <Input
                id="hero-subtitle"
                maxLength={240}
                value={draft.subtitle ?? ''}
                onChange={(e) => set('subtitle', e.target.value)}
              />
            </Field>
            <Field label="First button" htmlFor="hero-cta1-label" hint="Optional.">
              <Input
                id="hero-cta1-label"
                maxLength={40}
                placeholder="Browse inventory"
                value={draft.primaryCtaLabel ?? ''}
                onChange={(e) => set('primaryCtaLabel', e.target.value)}
              />
            </Field>
            <Field label="Its link" htmlFor="hero-cta1-url" hint={linkHint(draft.primaryCtaUrl)}>
              <Input
                id="hero-cta1-url"
                maxLength={500}
                placeholder="/vehicles"
                value={draft.primaryCtaUrl ?? ''}
                onChange={(e) => set('primaryCtaUrl', e.target.value)}
              />
            </Field>
            <Field
              label="Second button"
              htmlFor="hero-cta2-label"
              hint="Optional, drawn as an outline."
            >
              <Input
                id="hero-cta2-label"
                maxLength={40}
                placeholder="Sell my car"
                value={draft.secondaryCtaLabel ?? ''}
                onChange={(e) => set('secondaryCtaLabel', e.target.value)}
              />
            </Field>
            <Field label="Its link" htmlFor="hero-cta2-url" hint={linkHint(draft.secondaryCtaUrl)}>
              <Input
                id="hero-cta2-url"
                maxLength={500}
                placeholder="/register?role=SELLER"
                value={draft.secondaryCtaUrl ?? ''}
                onChange={(e) => set('secondaryCtaUrl', e.target.value)}
              />
            </Field>
            {halfButton(draft.primaryCtaLabel, draft.primaryCtaUrl) ||
            halfButton(draft.secondaryCtaLabel, draft.secondaryCtaUrl) ? (
              <p className="text-sm text-destructive sm:col-span-2">
                Give each button both a label and a link, or leave both blank.
              </p>
            ) : null}
            <Field label="Words" htmlFor="hero-align">
              <Select
                id="hero-align"
                value={draft.align}
                onChange={(e) => set('align', e.target.value as HomeHero['align'])}
              >
                <option value="LEFT">On the left</option>
                <option value="CENTER">Centred</option>
              </Select>
            </Field>
            <Field label="Height" htmlFor="hero-height">
              <Select
                id="hero-height"
                value={draft.height}
                onChange={(e) => set('height', e.target.value as HomeHero['height'])}
              >
                {HOME_HERO_HEIGHTS.map((height) => (
                  <option key={height} value={height}>
                    {HOME_HERO_HEIGHT_LABELS[height]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`Shade over the media: ${draft.overlayOpacity}%`}
              htmlFor="hero-overlay"
              hint="Darker keeps white words readable on a bright picture."
              className="sm:col-span-2"
            >
              <input
                id="hero-overlay"
                type="range"
                min={HOME_HERO_OVERLAY.min}
                max={HOME_HERO_OVERLAY.max}
                step={5}
                value={draft.overlayOpacity}
                onChange={(e) => set('overlayOpacity', Number(e.target.value))}
                className="accent-primary"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Picture or video</CardTitle>
            <CardDescription>
              Wide works best: 1920×1080 or larger. A video loops silently, for up to 30 seconds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MediaEditor
              idPrefix="hero"
              value={draft.media}
              onChange={(media) => set('media', media)}
            />
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <ErrorAlert error={save.error} className="w-full" />
        <Button
          variant="outline"
          loading={save.isPending && save.variables === false}
          disabled={invalid}
          onClick={() => save.mutate(false)}
        >
          Save as draft
        </Button>
        <Button
          loading={save.isPending && save.variables === true}
          disabled={invalid || !draft.media}
          onClick={() => save.mutate(true)}
        >
          Save and make active
        </Button>
        {!draft.media ? (
          <span className="text-sm text-muted-foreground">
            Choose a picture or video to make it active.
          </span>
        ) : null}
        {notice ? (
          <span role="status" className="text-sm text-muted-foreground">
            {notice}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminHeroPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <HeroEditor />
      </div>
    </RequireAuth>
  );
}
