'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  PlugZap,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type {
  EmailConnectionTestResult,
  EmailSettingsUpdateInput,
  EmailSettingsView,
  EmailTestSendResult,
} from '@vintrax/shared';
import { api, ApiError } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/utils';
import { useHasPermission } from '@/store/auth-store';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

interface FormState {
  enabled: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
}

/** A result line under the test buttons: what happened, in plain words. */
function Outcome({ ok, message }: { ok: boolean; message: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <p
      role="status"
      className={`mt-3 flex items-start gap-2 text-sm ${ok ? 'text-success' : 'text-destructive'}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

function EmailSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['admin-email-settings'],
    queryFn: () => api.get<EmailSettingsView>('/admin/settings/email'),
  });

  const [form, setForm] = useState<FormState | null>(null);
  // The key field is never filled from the server — there is nothing to fill
  // it with — and is cleared after every save.
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data && !form) {
      setForm({
        enabled: settings.data.enabled,
        fromName: settings.data.fromName,
        fromEmail: settings.data.fromEmail ?? '',
        replyTo: settings.data.replyTo ?? '',
      });
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: (body: EmailSettingsUpdateInput) =>
      api.put<EmailSettingsView>('/admin/settings/email', body),
    onSuccess: (view) => {
      queryClient.setQueryData(['admin-email-settings'], view);
      setApiKey('');
      setRemoveKey(false);
      setSaved(true);
      setForm({
        enabled: view.enabled,
        fromName: view.fromName,
        fromEmail: view.fromEmail ?? '',
        replyTo: view.replyTo ?? '',
      });
    },
  });
  const testConnection = useMutation({
    mutationFn: () =>
      api.post<EmailConnectionTestResult>('/admin/settings/email/test-connection', {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(form?.fromEmail.trim() ? { fromEmail: form.fromEmail.trim() } : {}),
      }),
  });
  const testEmail = useMutation({
    mutationFn: () => api.post<EmailTestSendResult>('/admin/settings/email/test-email', {}),
  });

  if (settings.isPending || !form) return <Spinner label="Loading email settings" />;
  if (settings.error) return <ErrorAlert error={settings.error} />;
  const view = settings.data!;
  const fieldError = (name: string) =>
    save.error instanceof ApiError ? save.error.fieldError(name) : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaved(false);
    save.mutate({
      provider: 'resend',
      enabled: removeKey ? false : form.enabled,
      fromName: form.fromName.trim(),
      fromEmail: form.fromEmail.trim(),
      replyTo: form.replyTo.trim() || null,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(removeKey ? { clearApiKey: true } : {}),
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Resend</CardTitle>
          <CardDescription>
            Account, security, notification and CRM email all send through the provider set here
            once it is switched on. Until then, the server&apos;s own settings stay in force.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!view.encryptionConfigured ? (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>
                This server cannot store an API key yet: <code>SETTINGS_ENCRYPTION_KEY</code> is not
                set in its environment. The other settings can be saved; ask whoever runs the server
                to add the key (see documentation/email.md).
              </span>
            </div>
          ) : null}
          <ErrorAlert error={save.error} className="mb-4" />
          {saved ? <Outcome ok message="Saved." /> : null}

          <form onSubmit={submit} noValidate className="mt-2 flex flex-col gap-4">
            <Field label="Provider" htmlFor="provider" hint="Resend is the only provider for now.">
              <Select id="provider" value="resend" disabled>
                <option value="resend">Resend</option>
              </Select>
            </Field>

            <Field
              label="API key"
              htmlFor="apiKey"
              error={fieldError('apiKey')}
              hint={
                view.apiKey.set
                  ? `A key ending …${view.apiKey.last4 ?? '????'} is stored${
                      view.apiKey.updatedAt
                        ? ` (saved ${formatRelativeTime(view.apiKey.updatedAt)})`
                        : ''
                    }. Leave this empty to keep it; enter a new one to replace it.`
                  : 'Create a sending-only key in Resend → API Keys. It is stored encrypted and never shown again.'
              }
            >
              <Input
                id="apiKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={view.apiKey.set ? `re_••••••••${view.apiKey.last4 ?? ''}` : 're_…'}
                value={apiKey}
                disabled={!view.encryptionConfigured || removeKey}
                onChange={(event) => setApiKey(event.target.value)}
                aria-invalid={Boolean(fieldError('apiKey'))}
              />
            </Field>
            {view.apiKey.set && !view.apiKey.decryptable ? (
              <p className="-mt-2 text-sm text-destructive">
                The stored key cannot be read on this server (the encryption key is missing or has
                changed). Enter the key again.
              </p>
            ) : null}
            {view.apiKey.set ? (
              <label className="-mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={removeKey}
                  onChange={(event) => {
                    setRemoveKey(event.target.checked);
                    if (event.target.checked) setApiKey('');
                  }}
                />
                Remove the stored key (this also switches these settings off)
              </label>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sender name" htmlFor="fromName" error={fieldError('fromName')}>
                <Input
                  id="fromName"
                  value={form.fromName}
                  maxLength={100}
                  onChange={(event) => setForm({ ...form, fromName: event.target.value })}
                  aria-invalid={Boolean(fieldError('fromName'))}
                />
              </Field>
              <Field
                label="Sender email"
                htmlFor="fromEmail"
                error={fieldError('fromEmail')}
                hint="On a domain verified in Resend, e.g. noreply@vintrax.ca."
              >
                <Input
                  id="fromEmail"
                  type="email"
                  value={form.fromEmail}
                  onChange={(event) => setForm({ ...form, fromEmail: event.target.value })}
                  aria-invalid={Boolean(fieldError('fromEmail'))}
                />
              </Field>
            </div>

            <Field
              label="Reply-to email (optional)"
              htmlFor="replyTo"
              error={fieldError('replyTo')}
              hint="A monitored inbox, e.g. support@vintrax.ca."
            >
              <Input
                id="replyTo"
                type="email"
                value={form.replyTo}
                onChange={(event) => setForm({ ...form, replyTo: event.target.value })}
                aria-invalid={Boolean(fieldError('replyTo'))}
              />
            </Field>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={form.enabled && !removeKey}
                disabled={removeKey}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              <span>
                <strong>Send all email through these settings.</strong> Test the connection first;
                if the key stops working, switch this off to fall back to the server&apos;s
                settings.
              </span>
            </label>

            <div>
              <Button type="submit" loading={save.isPending}>
                Save settings
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sending now</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={view.active.source === 'database' ? 'success' : 'outline'}>
                {view.active.source === 'database' ? 'These settings' : 'Server environment'}
              </Badge>
              <Badge variant={view.active.driver === 'log' ? 'warning' : 'default'}>
                {view.active.driver}
              </Badge>
            </div>
            <p className="break-all text-muted-foreground">From: {view.active.from}</p>
            {view.active.driver === 'log' ? (
              <p className="text-muted-foreground">
                The log driver sends nothing; it writes email to the server log.
              </p>
            ) : null}
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden /> The API key is stored encrypted and never
              sent back to this page.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Test</CardTitle>
            <CardDescription>
              Check the key and the sending domain, then send yourself an email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                loading={testConnection.isPending}
                onClick={() => testConnection.mutate()}
                disabled={!apiKey.trim() && !view.apiKey.set}
              >
                <PlugZap className="h-4 w-4" aria-hidden />
                Test connection
              </Button>
              <p className="text-xs text-muted-foreground">
                <KeyRound className="mr-1 inline h-3 w-3" aria-hidden />
                Uses the key typed above if there is one, otherwise the stored key. Nothing is
                saved.
              </p>
              {testConnection.data ? (
                <Outcome ok={testConnection.data.ok} message={testConnection.data.message} />
              ) : null}
              <ErrorAlert error={testConnection.error} />

              <Button
                variant="outline"
                className="mt-3"
                loading={testEmail.isPending}
                onClick={() => testEmail.mutate()}
              >
                <Send className="h-4 w-4" aria-hidden />
                Send a test email to me
              </Button>
              <p className="text-xs text-muted-foreground">
                <Mail className="mr-1 inline h-3 w-3" aria-hidden />
                Goes to your own verified address, through whatever is sending now.
              </p>
              {testEmail.data ? (
                <Outcome
                  ok={testEmail.data.ok}
                  message={`${testEmail.data.message}${testEmail.data.ok ? ` (to ${testEmail.data.to})` : ''}`}
                />
              ) : null}
              <ErrorAlert error={testEmail.error} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SuperAdminOnly() {
  const allowed = useHasPermission('settings:manage');
  if (!allowed) {
    return (
      <Card>
        <EmptyState
          icon={<Lock className="h-8 w-8" aria-hidden />}
          title="Super admins only"
          description="Email provider settings hold a secret key, so only a super admin can see or change them."
        />
      </Card>
    );
  }
  return <EmailSettings />;
}

export default function AdminEmailSettingsPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Settings · Email</h1>
          <p className="mt-1 text-muted-foreground">
            The email provider Vintrax sends through: the API key, the sender and the reply-to
            address.
          </p>
        </div>
        <SuperAdminOnly />
      </div>
    </RequireAuth>
  );
}
