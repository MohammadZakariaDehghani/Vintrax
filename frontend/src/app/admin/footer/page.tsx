'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Plus, Save, Trash2, X } from 'lucide-react';
import {
  FOOTER_COLUMNS,
  FOOTER_LINK_ICONS,
  FOOTER_LINK_ICON_LABELS,
  MAX_FOOTER_LINKS_PER_SECTION,
  MAX_FOOTER_SECTIONS,
  normalizeFooterHref,
  type AdminSiteSettings,
  type FooterLinkIcon,
  type FooterSection,
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
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { SocialBadge } from '@/components/footer-icons';

/** A row in the editor, with a key that survives reordering and deletion. */
interface LinkDraft {
  key: string;
  label: string;
  href: string;
  icon: FooterLinkIcon | '';
  /** An uploaded icon image, drawn instead of the built-in icon. */
  imageUrl: string;
}

interface SectionDraft {
  key: string;
  title: string;
  column: number;
  links: LinkDraft[];
}

let nextKey = 0;
const newKey = () => `row-${(nextKey += 1)}`;

function draftsFromSections(sections: FooterSection[]): SectionDraft[] {
  return sections.map((section) => ({
    key: newKey(),
    title: section.title,
    column: section.column,
    links: section.links.map((link) => ({
      key: newKey(),
      label: link.label,
      href: link.href,
      icon: link.icon ?? '',
      imageUrl: link.imageUrl ?? '',
    })),
  }));
}

/**
 * The site footer — "About us", "Resources", "Partners", "Stay in touch" by
 * default — as an ordered list of sections, each with its own ordered list of
 * links. Saved as a whole: there is no per-link endpoint, so adding one link
 * sends every section back, the same way the vehicle history timeline editor
 * works.
 */
function FooterEditor() {
  const queryClient = useQueryClient();
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  const footer = useQuery({
    queryKey: ['admin-footer'],
    queryFn: () => api.get<FooterSection[]>('/admin/footer'),
  });

  useEffect(() => {
    if (!footer.data || loaded) return;
    setSections(draftsFromSections(footer.data));
    setLoaded(true);
  }, [footer.data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      api.put<FooterSection[]>('/admin/footer', {
        sections: sections
          // A section with no title says nothing, so it is dropped rather
          // than rejected — an administrator who added one and changed their
          // mind should not have to find it again to save the rest.
          .filter((section) => section.title.trim().length > 0)
          .map((section) => ({
            title: section.title.trim(),
            column: section.column,
            links: section.links
              .filter((link) => link.label.trim().length > 0 && link.href.trim().length > 0)
              .map((link) => ({
                label: link.label.trim(),
                href: link.href.trim(),
                ...(link.icon ? { icon: link.icon } : {}),
                ...(link.imageUrl ? { imageUrl: link.imageUrl } : {}),
              })),
          })),
      }),
    onSuccess: (result) => {
      setSaved(true);
      setSections(draftsFromSections(result));
      void queryClient.invalidateQueries({ queryKey: ['admin-footer'] });
    },
  });

  function updateSection(key: string, patch: Partial<SectionDraft>) {
    setSaved(false);
    setSections((current) =>
      current.map((section) => (section.key === key ? { ...section, ...patch } : section)),
    );
  }

  function updateLink(sectionKey: string, linkKey: string, patch: Partial<LinkDraft>) {
    setSaved(false);
    setSections((current) =>
      current.map((section) =>
        section.key === sectionKey
          ? {
              ...section,
              links: section.links.map((link) =>
                link.key === linkKey ? { ...link, ...patch } : link,
              ),
            }
          : section,
      ),
    );
  }

  function addSection() {
    setSaved(false);
    setSections((current) => [
      ...current,
      {
        key: newKey(),
        title: '',
        column: Math.min(current.length + 1, FOOTER_COLUMNS),
        links: [],
      },
    ]);
  }

  function removeSection(key: string) {
    setSaved(false);
    setSections((current) => current.filter((section) => section.key !== key));
  }

  function addLink(sectionKey: string) {
    setSaved(false);
    setSections((current) =>
      current.map((section) =>
        section.key === sectionKey
          ? {
              ...section,
              links: [
                ...section.links,
                { key: newKey(), label: '', href: '', icon: '', imageUrl: '' },
              ],
            }
          : section,
      ),
    );
  }

  function removeLink(sectionKey: string, linkKey: string) {
    setSaved(false);
    setSections((current) =>
      current.map((section) =>
        section.key === sectionKey
          ? { ...section, links: section.links.filter((link) => link.key !== linkKey) }
          : section,
      ),
    );
  }

  if (footer.isPending) return <Spinner label="Loading the footer" />;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Site footer</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          What every visitor sees at the bottom of every page. Add up to {MAX_FOOTER_SECTIONS}{' '}
          sections, each with up to {MAX_FOOTER_LINKS_PER_SECTION} links, and choose which of the
          four columns each section sits in; two sections in one column stack. A link starting with{' '}
          <code>/</code> stays on the site, for example <code>/contact</code> or a page from Admin →
          Pages such as <code>/pages/about-us</code>. A web address such as{' '}
          <code>instagram.com/yourname</code> opens in a new tab. Links with a social network icon
          are drawn as round badges; upload an image to use your own logo instead.
        </p>
      </header>

      <ErrorAlert error={footer.error ?? save.error} className="mb-4" />

      <div className="flex flex-col gap-5">
        {sections.map((section) => (
          <Card key={section.key}>
            <CardContent className="flex flex-col gap-4 p-4">
              <div className="flex items-start gap-3">
                <Input
                  aria-label="Section title"
                  placeholder="About us"
                  maxLength={60}
                  value={section.title}
                  onChange={(e) => updateSection(section.key, { title: e.target.value })}
                  className="max-w-xs font-semibold"
                />
                <Select
                  aria-label="Column"
                  value={section.column}
                  onChange={(e) => updateSection(section.key, { column: Number(e.target.value) })}
                  className="w-36"
                >
                  {Array.from({ length: FOOTER_COLUMNS }, (_, index) => (
                    <option key={index} value={index + 1}>
                      Column {index + 1}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remove this section"
                  onClick={() => removeSection(section.key)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <div className="flex flex-col gap-3">
                {section.links.map((link) => (
                  <div
                    key={link.key}
                    className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_9rem_auto_auto]"
                  >
                    <Input
                      aria-label="Link label"
                      placeholder="Contact us"
                      maxLength={60}
                      value={link.label}
                      onChange={(e) => updateLink(section.key, link.key, { label: e.target.value })}
                    />
                    <div>
                      <Input
                        aria-label="Link destination"
                        placeholder="/contact or instagram.com/…"
                        maxLength={300}
                        value={link.href}
                        onChange={(e) =>
                          updateLink(section.key, link.key, { href: e.target.value })
                        }
                      />
                      {link.href.trim() && normalizeFooterHref(link.href) !== link.href.trim() ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Saved as {normalizeFooterHref(link.href)}
                        </p>
                      ) : null}
                    </div>
                    <Select
                      aria-label="Icon"
                      value={link.icon}
                      onChange={(e) =>
                        updateLink(section.key, link.key, {
                          icon: e.target.value as FooterLinkIcon | '',
                        })
                      }
                    >
                      <option value="">No icon</option>
                      {FOOTER_LINK_ICONS.map((icon) => (
                        <option key={icon} value={icon}>
                          {FOOTER_LINK_ICON_LABELS[icon]}
                        </option>
                      ))}
                    </Select>
                    <LinkImagePicker
                      imageUrl={link.imageUrl}
                      icon={link.icon || null}
                      onChange={(imageUrl) => updateLink(section.key, link.key, { imageUrl })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Remove this link"
                      onClick={() => removeLink(section.key, link.key)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => addLink(section.key)}
                disabled={section.links.length >= MAX_FOOTER_LINKS_PER_SECTION}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Add a link
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addSection}
          disabled={sections.length >= MAX_FOOTER_SECTIONS}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Add a section
        </Button>
        <Button type="button" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-2 h-4 w-4" aria-hidden />
          Save footer
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
      </div>
    </>
  );
}

/**
 * A link's own icon image — a Facebook or Instagram logo the administrator
 * prefers to the built-in one. Uploaded straight away; kept by saving the
 * footer.
 */
function LinkImagePicker({
  imageUrl,
  icon,
  onChange,
}: {
  imageUrl: string;
  icon: FooterLinkIcon | null;
  onChange: (imageUrl: string) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => api.upload<{ url: string }>('/uploads/footer-icons', file),
    onSuccess: (stored) => onChange(stored.url),
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {imageUrl ? (
          <>
            <SocialBadge icon={icon} imageUrl={imageUrl} className="h-9 w-9" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Remove the uploaded icon"
              onClick={() => onChange('')}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={upload.isPending}
            onClick={() => input.current?.click()}
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            Icon image
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
      </div>
      {upload.error ? <ErrorAlert error={upload.error} className="px-2 py-1 text-xs" /> : null}
    </div>
  );
}

/**
 * The two lines under the footer's rule. The year is added automatically, so
 * "© Copyright 2026" never goes stale.
 */
function CopyrightEditor() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-site-settings'],
    queryFn: () => api.get<AdminSiteSettings>('/admin/site-settings'),
  });
  const [copyright, setCopyright] = useState('');
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings.data || loaded) return;
    setCopyright(settings.data.footerCopyright);
    setNote(settings.data.footerNote ?? '');
    setLoaded(true);
  }, [settings.data, loaded]);

  const save = useMutation({
    mutationFn: () => {
      // `updatedAt` is read-only; left undefined, it is dropped from the JSON.
      return api.put<AdminSiteSettings>('/admin/site-settings', {
        ...settings.data,
        updatedAt: undefined,
        footerCopyright: copyright,
        footerNote: note,
      });
    },
    onSuccess: (result) => {
      setSaved(true);
      queryClient.setQueryData(['admin-site-settings'], result);
    },
  });

  if (settings.isPending) return null;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Copyright lines</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Shown under the rule at the bottom of the footer, as “© Copyright {new Date().getFullYear()}{' '}
        …”. The year updates itself.
      </p>
      <ErrorAlert error={settings.error ?? save.error} className="mt-3" />
      <Card className="mt-3">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="After “© Copyright year”" htmlFor="footer-copyright">
            <Input
              id="footer-copyright"
              maxLength={120}
              placeholder="Vintrax."
              value={copyright}
              onChange={(e) => {
                setSaved(false);
                setCopyright(e.target.value);
              }}
            />
          </Field>
          <Field label="Second line" htmlFor="footer-note">
            <Input
              id="footer-note"
              maxLength={300}
              placeholder="All rights reserved."
              value={note}
              onChange={(e) => {
                setSaved(false);
                setNote(e.target.value);
              }}
            />
          </Field>
        </CardContent>
      </Card>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-2 h-4 w-4" aria-hidden />
          Save copyright lines
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
      </div>
    </section>
  );
}

export default function AdminFooterPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <FooterEditor />
        <CopyrightEditor />
      </div>
    </RequireAuth>
  );
}
