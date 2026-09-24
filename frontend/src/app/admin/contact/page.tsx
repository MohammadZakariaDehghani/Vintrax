'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImagePlus, Save, Trash2 } from 'lucide-react';
import type { AdminSiteSettings, ContactMessage, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Spinner,
  Textarea,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

type ContactFields = Pick<
  AdminSiteSettings,
  | 'contactIntro'
  | 'contactAddress'
  | 'contactPhone'
  | 'contactEmail'
  | 'contactHours'
  | 'contactMapImageUrl'
  | 'contactRecipient'
>;

const FIELDS: Array<keyof ContactFields> = [
  'contactIntro',
  'contactAddress',
  'contactPhone',
  'contactEmail',
  'contactHours',
  'contactMapImageUrl',
  'contactRecipient',
];

/**
 * What the Contact page shows, and where its form sends messages. Saved as a
 * whole with the rest of the site settings (the footer's copyright lines are
 * carried along unchanged).
 */
function ContactSettings() {
  const queryClient = useQueryClient();
  const mapInput = useRef<HTMLInputElement | null>(null);
  const settings = useQuery({
    queryKey: ['admin-site-settings'],
    queryFn: () => api.get<AdminSiteSettings>('/admin/site-settings'),
  });
  const [draft, setDraft] = useState<Record<keyof ContactFields, string>>(
    Object.fromEntries(FIELDS.map((key) => [key, ''])) as Record<keyof ContactFields, string>,
  );
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings.data || loaded) return;
    setDraft(
      Object.fromEntries(FIELDS.map((key) => [key, settings.data[key] ?? ''])) as Record<
        keyof ContactFields,
        string
      >,
    );
    setLoaded(true);
  }, [settings.data, loaded]);

  function set(key: keyof ContactFields, value: string) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const uploadMap = useMutation({
    mutationFn: (file: File) => api.upload<{ url: string }>('/uploads/site-images', file),
    onSuccess: (stored) => set('contactMapImageUrl', stored.url),
  });

  const save = useMutation({
    mutationFn: () => {
      // `updatedAt` is read-only; left undefined, it is dropped from the JSON.
      return api.put<AdminSiteSettings>('/admin/site-settings', {
        ...settings.data,
        updatedAt: undefined,
        ...draft,
      });
    },
    onSuccess: (result) => {
      setSaved(true);
      queryClient.setQueryData(['admin-site-settings'], result);
    },
  });

  if (settings.isPending) return <Spinner label="Loading the contact settings" />;

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contact page</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What <code>/contact</code> shows, and where its form sends messages. Leave a field blank
            to leave it off the page. Link to the page from the footer with <code>/contact</code>.
          </p>
        </div>
        <Link href="/contact" target="_blank">
          <Button type="button" variant="outline">
            <ExternalLink className="h-4 w-4" aria-hidden />
            View the page
          </Button>
        </Link>
      </header>

      <ErrorAlert error={settings.error ?? uploadMap.error ?? save.error} className="mb-4" />

      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Introduction" htmlFor="contact-intro" className="sm:col-span-2">
            <Textarea
              id="contact-intro"
              rows={2}
              maxLength={600}
              value={draft.contactIntro}
              onChange={(e) => set('contactIntro', e.target.value)}
            />
          </Field>
          <Field label="Address" htmlFor="contact-address" hint="One line per line of the address.">
            <Textarea
              id="contact-address"
              rows={3}
              maxLength={300}
              value={draft.contactAddress}
              onChange={(e) => set('contactAddress', e.target.value)}
            />
          </Field>
          <Field label="Opening hours" htmlFor="contact-hours" hint="For example Mon–Fri 9–5.">
            <Textarea
              id="contact-hours"
              rows={3}
              maxLength={300}
              value={draft.contactHours}
              onChange={(e) => set('contactHours', e.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="contact-phone">
            <Input
              id="contact-phone"
              maxLength={40}
              value={draft.contactPhone}
              onChange={(e) => set('contactPhone', e.target.value)}
            />
          </Field>
          <Field label="Email shown on the page" htmlFor="contact-email">
            <Input
              id="contact-email"
              type="email"
              maxLength={254}
              value={draft.contactEmail}
              onChange={(e) => set('contactEmail', e.target.value)}
            />
          </Field>
          <Field
            label="Send form messages to"
            htmlFor="contact-recipient"
            hint="Not shown on the page. Blank sends them to the email above."
            className="sm:col-span-2"
          >
            <Input
              id="contact-recipient"
              type="email"
              maxLength={254}
              value={draft.contactRecipient}
              onChange={(e) => set('contactRecipient', e.target.value)}
            />
          </Field>
          <Field
            label="Map"
            htmlFor="contact-map"
            hint="Upload a map or a photo of the location. Without one, the page shows a Google map of the address."
            className="sm:col-span-2"
          >
            <div className="flex flex-wrap items-center gap-3">
              {draft.contactMapImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.contactMapImageUrl}
                  alt=""
                  className="h-24 w-36 rounded border border-border object-cover"
                />
              ) : null}
              <input
                ref={mapInput}
                id="contact-map"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMap.mutate(file);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={uploadMap.isPending}
                onClick={() => mapInput.current?.click()}
              >
                <ImagePlus className="h-4 w-4" aria-hidden />
                {draft.contactMapImageUrl ? 'Replace map' : 'Upload map'}
              </Button>
              {draft.contactMapImageUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set('contactMapImageUrl', '')}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </Field>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" loading={save.isPending} onClick={() => save.mutate()}>
          <Save className="h-4 w-4" aria-hidden />
          Save contact page
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
      </div>
    </section>
  );
}

/** Messages sent through the form, kept even when the email could not be delivered. */
function ContactInbox() {
  const queryClient = useQueryClient();
  const messages = useQuery({
    queryKey: ['admin-contact-messages'],
    queryFn: () => api.get<Paginated<ContactMessage>>('/admin/contact-messages?page=1&pageSize=50'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/contact-messages/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-contact-messages'] }),
  });

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold">Messages</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every message is emailed and also kept here, so none is lost if email is down.
      </p>
      <ErrorAlert error={messages.error ?? remove.error} className="mt-3" />
      {messages.isLoading ? (
        <Spinner label="Loading messages" />
      ) : messages.data && messages.data.items.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3">
          {messages.data.items.map((message) => (
            <li key={message.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{message.subject}</p>
                      <p className="text-sm text-muted-foreground">
                        {message.name} ·{' '}
                        <a href={`mailto:${message.email}`} className="underline">
                          {message.email}
                        </a>
                        {message.phone ? ` · ${message.phone}` : ''} ·{' '}
                        {new Date(message.createdAt).toLocaleString('en-CA')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete the message from ${message.name}`}
                      loading={remove.isPending && remove.variables === message.id}
                      onClick={() => remove.mutate(message.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm">{message.message}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No messages yet" />
      )}
    </section>
  );
}

export default function AdminContactPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <ContactSettings />
        <ContactInbox />
      </div>
    </RequireAuth>
  );
}
