'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImagePlus, Trash2 } from 'lucide-react';
import {
  articleMedia,
  type Article,
  type ArticleKind,
  type ArticleStatus,
  type MediaPresentation,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  Button,
  Card,
  CardContent,
  ErrorAlert,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { MediaEditor } from '@/components/media/admin/media-editor';
import { LivePreview } from '@/components/media/admin/live-preview';
import { stillUrl, toMediaInput } from '@/lib/media-input';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 10 * 1024 * 1024;

interface Uploaded {
  url: string;
}

/**
 * Writing and editing a post.
 *
 * The preview is the real masthead component rather than an approximation, so
 * what the author signs off on is what the home page renders. A separate
 * "preview" built to look similar is a thing that drifts, and the first person
 * to notice would be a visitor.
 */
export function ArticleEditor({
  article,
  kind: newKind = 'POST',
}: {
  article?: Article;
  /** What a new one is; an existing one keeps the kind it was created as. */
  kind?: ArticleKind;
}) {
  const kind = article?.kind ?? newKind;
  const isPage = kind === 'PAGE';
  const adminBase = isPage ? '/admin/pages' : '/admin/blog';
  const listKey = isPage ? 'admin-pages' : 'admin-articles';
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState(article?.title ?? '');
  const [subtitle, setSubtitle] = useState(article?.subtitle ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  // A page keeps a plain photograph; a post shows media from the library —
  // or, written before the library, the photograph it has always had.
  const [pagePhoto, setPagePhoto] = useState(article?.heroImageUrl ?? '');
  const [pageAlt, setPageAlt] = useState(article?.heroAlt ?? '');
  const [media, setMedia] = useState<MediaPresentation | null>(
    article && article.kind === 'POST' ? articleMedia(article) : null,
  );
  // A post's plain picture — for cards and sharing — is its photo, or its video's poster.
  const heroImageUrl = isPage ? pagePhoto : (stillUrl(media) ?? '');
  const heroAlt = isPage ? pageAlt : (media?.alt ?? '');
  const [ctaLabel, setCtaLabel] = useState(article?.ctaLabel ?? '');
  const [ctaHref, setCtaHref] = useState(article?.ctaHref ?? '');
  const [status, setStatus] = useState<ArticleStatus>(article?.status ?? 'DRAFT');
  const [failure, setFailure] = useState<unknown>(null);

  const upload = useMutation({
    mutationFn: (file: File) => api.upload<Uploaded>('/uploads/article-images', file),
    onSuccess: (stored) => setPagePhoto(stored.url),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        subtitle: subtitle.trim() || (article ? null : undefined),
        body,
        // A page may go without a photograph; clearing one on an existing
        // page sends null, which removes it.
        heroImageUrl: heroImageUrl || (article ? null : undefined),
        heroAlt: heroAlt.trim() || (article ? null : undefined),
        ...(isPage ? {} : { media: toMediaInput(media) }),
        ctaLabel: ctaLabel.trim() || (article ? null : undefined),
        ctaHref: ctaHref.trim() || (article ? null : undefined),
        status,
        ...(article ? {} : { kind }),
      };
      return article
        ? api.patch<Article>(`/admin/articles/${article.id}`, payload)
        : api.post<Article>('/admin/articles', payload);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: [listKey] });
      router.push(`${adminBase}/${saved.slug}`);
      router.refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/articles/${article?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [listKey] });
      router.push(adminBase);
      router.refresh();
    },
  });

  function choose(file: File | undefined) {
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
    upload.mutate(file);
  }

  // Mirrors the API's rule rather than trusting it to be the only check, so the
  // author is told before they press save rather than after.
  const ctaIncomplete = Boolean(ctaLabel.trim()) !== Boolean(ctaHref.trim());
  const ctaExternal = ctaHref.trim() !== '' && !/^\/(?!\/)/.test(ctaHref.trim());
  const canSave =
    title.trim().length >= 4 &&
    body.trim().length > 0 &&
    (isPage || heroImageUrl !== '') &&
    !ctaIncomplete &&
    !ctaExternal;

  const preview = useMemo(
    () => ({
      kind: 'article' as const,
      article: {
        id: article?.id ?? 'preview',
        slug: article?.slug ?? 'preview',
        kind,
        title: title || 'Your headline',
        subtitle: subtitle || null,
        heroImageUrl: heroImageUrl || null,
        heroAlt: heroAlt || null,
        ctaLabel: ctaLabel || null,
        ctaHref: ctaHref || null,
        media,
        homeOrder: article?.homeOrder ?? null,
        status,
        publishedAt: article?.publishedAt ?? new Date().toISOString(),
        authorName: article?.authorName ?? null,
        createdAt: article?.createdAt ?? new Date().toISOString(),
        updatedAt: article?.updatedAt ?? new Date().toISOString(),
      },
    }),
    [article, kind, title, subtitle, heroImageUrl, heroAlt, ctaLabel, ctaHref, media, status],
  );

  return (
    <div className="space-y-6">
      {/* The preview goes above the form, full width, because the thing being
          previewed is 1920×330 — a wide, short band. In a sidebar it is either
          clipped or too small to judge, and a preview you cannot judge is
          worse than none. */}
      {isPage ? (
        heroImageUrl ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Photograph</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImageUrl}
              alt=""
              className="aspect-[1920/460] w-full rounded-lg border border-border object-cover"
            />
          </section>
        ) : null
      ) : (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Home page preview</h2>
          {media ? (
            <LivePreview payload={preview} />
          ) : (
            <div className="grid w-full aspect-[1920/330] min-h-[10rem] place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              Choose a picture or a video to see the masthead
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            The same component the home page renders, so this is exactly what a visitor sees.
          </p>
        </section>
      )}

      <div className="space-y-4">
        {failure ? <ErrorAlert error={failure} /> : null}
        {upload.error ? <ErrorAlert error={upload.error} /> : null}
        {save.error ? <ErrorAlert error={save.error} /> : null}
        {remove.error ? <ErrorAlert error={remove.error} /> : null}

        <Card>
          <CardContent className="space-y-4 p-5">
            <Field
              label={isPage ? 'Title' : 'Headline'}
              htmlFor="title"
              hint={
                isPage
                  ? `The page's heading. Its address is made from it: /pages/${article?.slug ?? 'your-title'}.`
                  : 'Shown on the masthead. Keep it short enough to read at a glance.'
              }
            >
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={140}
              />
            </Field>

            <Field
              label="Standfirst"
              htmlFor="subtitle"
              hint="Optional. One line under the headline."
            >
              <Input
                id="subtitle"
                value={subtitle}
                onChange={(event) => setSubtitle(event.target.value)}
                maxLength={180}
              />
            </Field>

            {isPage ? (
              <>
                <Field
                  label="Photograph"
                  htmlFor="hero"
                  hint="Optional. A wide, landscape shot across the top of the page."
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInput}
                      id="hero"
                      type="file"
                      accept={ACCEPTED.join(',')}
                      className="sr-only"
                      onChange={(event) => {
                        choose(event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      loading={upload.isPending}
                      onClick={() => fileInput.current?.click()}
                    >
                      <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden />
                      {pagePhoto ? 'Replace photograph' : 'Upload photograph'}
                    </Button>
                    {pagePhoto ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setPagePhoto('')}
                      >
                        Remove photograph
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Optional</span>
                    )}
                  </div>
                </Field>

                <Field
                  label="Photograph description"
                  htmlFor="heroAlt"
                  hint="Optional. Read aloud by screen readers; leave blank if the photo is purely decorative."
                >
                  <Input
                    id="heroAlt"
                    value={pageAlt}
                    onChange={(event) => setPageAlt(event.target.value)}
                    maxLength={160}
                  />
                </Field>
              </>
            ) : (
              <div>
                <p className="mb-1 text-sm font-medium">Picture or video</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Required. Wide works best — it is cropped to about 1920×330 on the home page, so
                  keep the subject away from the edges. A video plays silently on the home page and
                  the post; cards show its poster.
                </p>
                <MediaEditor
                  idPrefix="post"
                  value={media}
                  onChange={setMedia}
                  required={Boolean(article)}
                />
              </div>
            )}

            <Field
              label={isPage ? 'Page text' : 'Article'}
              htmlFor="body"
              hint="Plain text. Leave a blank line between paragraphs."
            >
              <Textarea
                id="body"
                rows={16}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="font-semibold">Button</h2>
            <p className="-mt-2 text-sm text-muted-foreground">
              Optional, and both fields go together. It points somewhere on Vintrax — the front page
              should send people into the catalogue, not off the site.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button text" htmlFor="ctaLabel">
                <Input
                  id="ctaLabel"
                  value={ctaLabel}
                  onChange={(event) => setCtaLabel(event.target.value)}
                  maxLength={40}
                  placeholder="Browse winter-ready SUVs"
                />
              </Field>
              <Field
                label="Button link"
                htmlFor="ctaHref"
                hint={
                  ctaExternal
                    ? 'Must start with “/” — an Vintrax page.'
                    : 'For example /vehicles?bodyType=SUV'
                }
              >
                <Input
                  id="ctaHref"
                  value={ctaHref}
                  onChange={(event) => setCtaHref(event.target.value)}
                  maxLength={200}
                  placeholder="/vehicles?bodyType=SUV"
                />
              </Field>
            </div>
            {ctaIncomplete ? (
              <p className="text-sm text-destructive">
                Give the button both a text and a link, or leave both blank.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-wrap items-end justify-between gap-4 p-5">
            <Field
              label="Status"
              htmlFor="status"
              hint={
                isPage
                  ? 'Only a published page can be visited. Link to it from Admin → Footer.'
                  : 'Only a published post appears on the site. Archived keeps the writing but takes it off.'
              }
            >
              <Select
                id="status"
                value={status}
                onChange={(event) => setStatus(event.target.value as ArticleStatus)}
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </Select>
            </Field>

            <div className="flex flex-wrap gap-2">
              {article ? (
                <>
                  <Link
                    href={isPage ? `/pages/${article.slug}` : `/blog/${article.slug}`}
                    target="_blank"
                  >
                    <Button type="button" variant="outline">
                      <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />
                      View
                    </Button>
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    loading={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                    Delete
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                loading={save.isPending}
                disabled={!canSave}
                onClick={() => save.mutate()}
              >
                {article ? 'Save changes' : isPage ? 'Create page' : 'Create post'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
