'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { contactMessageSchema } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Button, ErrorAlert, Field, Input, Textarea } from '@/components/ui';

const EMPTY = { name: '', email: '', phone: '', subject: '', message: '', website: '' };
type Fields = typeof EMPTY;

/**
 * The Contact page's form. Checked against the same schema the API applies,
 * so a mistake is shown beside its field before anything is sent.
 *
 * `website` is a honeypot: hidden from people and from assistive technology,
 * so only a bot filling every input puts anything in it, and the API then
 * drops the message quietly.
 */
export function ContactForm() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});

  const send = useMutation({
    mutationFn: (payload: unknown) => api.post<{ received: true }>('/contact', payload),
    onSuccess: () => setFields(EMPTY),
  });

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = contactMessageSchema.safeParse({
      ...fields,
      phone: fields.phone || null,
      website: fields.website || undefined,
    });
    if (!parsed.success) {
      const next: Partial<Record<keyof Fields, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Fields;
        next[key] ??= key === 'email' ? 'Enter a valid email address' : issue.message;
      }
      setErrors(next);
      return;
    }
    send.mutate(parsed.data);
  }

  if (send.isSuccess) {
    return (
      <div role="status" className="flex flex-col items-start gap-3 py-6">
        <CheckCircle2 className="h-8 w-8 text-success" aria-hidden />
        <h2 className="text-lg font-semibold">Thank you, your message is on its way.</h2>
        <p className="text-sm text-muted-foreground">
          We will reply to the email address you gave us.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => send.reset()}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <ErrorAlert error={send.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="contact-name" error={errors.name}>
          <Input
            id="contact-name"
            autoComplete="name"
            maxLength={100}
            value={fields.name}
            aria-invalid={Boolean(errors.name)}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="contact-email" error={errors.email}>
          <Input
            id="contact-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={fields.email}
            aria-invalid={Boolean(errors.email)}
            onChange={(e) => set('email', e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone (optional)" htmlFor="contact-phone" error={errors.phone}>
          <Input
            id="contact-phone"
            type="tel"
            autoComplete="tel"
            maxLength={40}
            value={fields.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>
        <Field label="Subject" htmlFor="contact-subject" error={errors.subject}>
          <Input
            id="contact-subject"
            maxLength={150}
            value={fields.subject}
            aria-invalid={Boolean(errors.subject)}
            onChange={(e) => set('subject', e.target.value)}
          />
        </Field>
      </div>
      <Field label="Message" htmlFor="contact-message" error={errors.message}>
        <Textarea
          id="contact-message"
          rows={7}
          maxLength={5000}
          value={fields.message}
          aria-invalid={Boolean(errors.message)}
          onChange={(e) => set('message', e.target.value)}
        />
      </Field>
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          tabIndex={-1}
          autoComplete="off"
          value={fields.website}
          onChange={(e) => set('website', e.target.value)}
        />
      </div>
      <Button type="submit" className="self-start" loading={send.isPending}>
        <Send className="h-4 w-4" aria-hidden />
        Send message
      </Button>
    </form>
  );
}
