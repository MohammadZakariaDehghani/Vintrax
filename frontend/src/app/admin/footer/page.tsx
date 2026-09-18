'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import {
  FOOTER_LINK_ICONS,
  FOOTER_LINK_ICON_LABELS,
  MAX_FOOTER_LINKS_PER_SECTION,
  MAX_FOOTER_SECTIONS,
  type FooterLinkIcon,
  type FooterSection,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Button, Card, CardContent, ErrorAlert, Input, Select, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

/** A row in the editor, with a key that survives reordering and deletion. */
interface LinkDraft {
  key: string;
  label: string;
  href: string;
  icon: FooterLinkIcon | '';
}

interface SectionDraft {
  key: string;
  title: string;
  links: LinkDraft[];
}

let nextKey = 0;
const newKey = () => `row-${(nextKey += 1)}`;

function draftsFromSections(sections: FooterSection[]): SectionDraft[] {
  return sections.map((section) => ({
    key: newKey(),
    title: section.title,
    links: section.links.map((link) => ({
      key: newKey(),
      label: link.label,
      href: link.href,
      icon: link.icon ?? '',
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
            links: section.links
              .filter((link) => link.label.trim().length > 0 && link.href.trim().length > 0)
              .map((link) => ({
                label: link.label.trim(),
                href: link.href.trim(),
                ...(link.icon ? { icon: link.icon } : {}),
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
    setSections((current) => [...current, { key: newKey(), title: '', links: [] }]);
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
          ? { ...section, links: [...section.links, { key: newKey(), label: '', href: '', icon: '' }] }
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
          sections, each with up to {MAX_FOOTER_LINKS_PER_SECTION} links. A link starting with{' '}
          <code>/</code> stays on the site; an <code>https://</code>, <code>mailto:</code> or{' '}
          <code>tel:</code> address leaves it. The icon is decorative — Vintrax does not check that
          it matches where the link actually goes.
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
                  <div key={link.key} className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
                    <Input
                      aria-label="Link label"
                      placeholder="Contact us"
                      maxLength={60}
                      value={link.label}
                      onChange={(e) => updateLink(section.key, link.key, { label: e.target.value })}
                    />
                    <Input
                      aria-label="Link destination"
                      placeholder="/contact or https://…"
                      maxLength={300}
                      value={link.href}
                      onChange={(e) => updateLink(section.key, link.key, { href: e.target.value })}
                    />
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

export default function AdminFooterPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <FooterEditor />
      </div>
    </RequireAuth>
  );
}
