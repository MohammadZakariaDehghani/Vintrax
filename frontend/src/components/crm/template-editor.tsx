'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TEMPLATE_CATEGORIES, type TemplateVariable } from '@vintrax/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { dateTime, humanize, type CrmClient, type Template } from '@/lib/crm';
import { fieldError } from './ui';

/**
 * The template editor for both CRMs: subject, HTML body, plain-text
 * fallback, variables, a rendered preview and a test send to yourself. The
 * server sanitises the HTML and refuses unknown variables.
 */
export function TemplateEditor({
  api,
  id,
  queryKey,
  backHref,
  variables,
  canEdit,
  allowMarketing,
  myEmail,
}: {
  api: CrmClient;
  id: string;
  queryKey: unknown[];
  backHref: string;
  variables: readonly TemplateVariable[];
  canEdit: boolean;
  allowMarketing: boolean;
  myEmail: string;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const isNew = id === 'new';
  const template = useQuery({
    queryKey: [...queryKey, 'template', id],
    queryFn: () => api.get<Template>(`/templates/${id}`),
    enabled: !isNew,
  });
  const [form, setForm] = useState({
    name: '',
    category: 'FOLLOW_UP',
    purpose: 'TRANSACTIONAL',
    subject: '',
    bodyHtml: '',
    bodyText: '',
    isActive: true,
  });
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(
    null,
  );
  useEffect(() => {
    if (template.data) {
      const t = template.data;
      setForm({
        name: t.name,
        category: t.category,
        purpose: t.purpose,
        subject: t.subject,
        bodyHtml: t.bodyHtml,
        bodyText: t.bodyText,
        isActive: t.isActive,
      });
    }
  }, [template.data]);
  const invalidate = () => client.invalidateQueries({ queryKey: [queryKey[0]] });
  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, bodyText: form.bodyText || null };
      return isNew
        ? api.post<Template>('/templates', payload)
        : api.put<Template>(`/templates/${id}`, payload);
    },
    onSuccess: async (saved) => {
      await invalidate();
      if (isNew) router.push(`${backHref}/${saved.id}`);
    },
  });
  const restore = useMutation({
    mutationFn: (version: number) => api.post(`/templates/${id}/restore`, { version }),
    onSuccess: invalidate,
  });
  const doPreview = useMutation({
    mutationFn: () =>
      api.post<{ subject: string; html: string; text: string }>(
        queryKey[0] === 'crm' ? '/email/preview' : '/templates/preview',
        { subject: form.subject, bodyHtml: form.bodyHtml },
      ),
    onSuccess: setPreview,
  });
  const test = useMutation({
    mutationFn: () =>
      api.post('/templates/test', { subject: form.subject, bodyHtml: form.bodyHtml, to: myEmail }),
  });
  const insert = (variable: string) =>
    setForm((previous) => ({ ...previous, bodyHtml: `${previous.bodyHtml}{{${variable}}}` }));

  if (!isNew && template.isPending) return <Spinner />;
  if (template.error) return <ErrorAlert error={template.error} />;
  const error = save.error;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4">
        <Card>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="tpl-name" error={fieldError(error, 'name')}>
              <Input
                id="tpl-name"
                disabled={!canEdit}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label="Category" htmlFor="tpl-category">
              <Select
                id="tpl-category"
                disabled={!canEdit}
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                {TEMPLATE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {humanize(category)}
                  </option>
                ))}
              </Select>
            </Field>
            {allowMarketing ? (
              <Field
                label="Kind"
                htmlFor="tpl-purpose"
                hint="Marketing goes only to customers with consent, with an unsubscribe link."
              >
                <Select
                  id="tpl-purpose"
                  disabled={!canEdit}
                  value={form.purpose}
                  onChange={(event) => setForm({ ...form, purpose: event.target.value })}
                >
                  <option value="TRANSACTIONAL">Transactional (answers their request)</option>
                  <option value="MARKETING">Marketing</option>
                </Select>
              </Field>
            ) : null}
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />{' '}
              Active
            </label>
            <Field
              label="Subject"
              htmlFor="tpl-subject"
              className="sm:col-span-2"
              error={fieldError(error, 'subject')}
            >
              <Input
                id="tpl-subject"
                disabled={!canEdit}
                value={form.subject}
                onChange={(event) => setForm({ ...form, subject: event.target.value })}
              />
            </Field>
            <Field
              label="Body (HTML)"
              htmlFor="tpl-body"
              className="sm:col-span-2"
              error={fieldError(error, 'bodyHtml')}
              hint="Paragraphs, bold, links and lists. Scripts and styles are removed when you save."
            >
              <Textarea
                id="tpl-body"
                rows={14}
                className="font-mono text-xs"
                disabled={!canEdit}
                value={form.bodyHtml}
                onChange={(event) => setForm({ ...form, bodyHtml: event.target.value })}
              />
            </Field>
            <Field
              label="Plain-text version (optional)"
              htmlFor="tpl-text"
              className="sm:col-span-2"
              hint="Left empty, it is made from the HTML."
            >
              <Textarea
                id="tpl-text"
                rows={5}
                disabled={!canEdit}
                value={form.bodyText}
                onChange={(event) => setForm({ ...form, bodyText: event.target.value })}
              />
            </Field>
          </CardContent>
        </Card>
        <ErrorAlert error={error ?? doPreview.error ?? test.error ?? restore.error} />
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          ) : null}
          <Button
            variant="outline"
            loading={doPreview.isPending}
            disabled={!form.subject || !form.bodyHtml}
            onClick={() => doPreview.mutate()}
          >
            Preview
          </Button>
          {canEdit ? (
            <Button
              variant="outline"
              loading={test.isPending}
              disabled={!form.subject || !form.bodyHtml}
              onClick={() => test.mutate()}
            >
              Send a test to {myEmail}
            </Button>
          ) : null}
          {save.isSuccess ? <span className="self-center text-sm text-success">Saved.</span> : null}
          {test.isSuccess ? (
            <span className="self-center text-sm text-success">Test sent.</span>
          ) : null}
        </div>
        {preview ? (
          <Card>
            <CardContent className="pt-4">
              <p className="mb-2 text-sm">
                <span className="text-muted-foreground">Subject:</span>{' '}
                <strong>{preview.subject}</strong>
              </p>
              {/* Sanitised and rendered by the server with sample values. */}
              <div
                className="prose prose-sm max-w-none rounded-md border border-border p-3"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground">Plain text</summary>
                <pre className="whitespace-pre-wrap text-xs">{preview.text}</pre>
              </details>
            </CardContent>
          </Card>
        ) : null}
      </div>
      <aside className="space-y-4">
        <Card>
          <CardContent className="pt-4">
            <h2 className="mb-2 text-sm font-semibold">Variables</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Click to add to the body. A missing value reads as nothing (or “there” for a first
              name).
            </p>
            <div className="flex flex-wrap gap-1">
              {variables.map((variable) => (
                <button
                  key={variable}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => insert(variable)}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] hover:bg-secondary"
                >
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        {template.data?.history?.length ? (
          <Card>
            <CardContent className="pt-4">
              <h2 className="mb-2 text-sm font-semibold">
                Version {template.data.version} · history
              </h2>
              <ul className="space-y-1 text-xs">
                {template.data.history.map((entry) => (
                  <li key={entry.version} className="flex items-center justify-between gap-2">
                    <span>
                      v{entry.version} · {dateTime(entry.savedAt)}
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => restore.mutate(entry.version)}
                      >
                        Restore
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
        {template.data?.key ? <Badge variant="outline">Starting template</Badge> : null}
      </aside>
    </div>
  );
}
