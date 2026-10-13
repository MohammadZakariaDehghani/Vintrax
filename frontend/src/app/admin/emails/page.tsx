'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCheck, Inbox, MailWarning, RotateCcw, Send } from 'lucide-react';
import type {
  AdminEmailRow,
  EmailMessageStatus,
  EmailStats,
  Paginated,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/utils';
import { useHasPermission } from '@/store/auth-store';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Input,
  Pagination,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';
import { StatTile } from '@/components/stat-tile';

type Filter = 'ALL' | 'FAILED' | 'BOUNCED' | 'DELIVERED' | 'ACCEPTED';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'BOUNCED', label: 'Bounced' },
  { id: 'ACCEPTED', label: 'Accepted' },
  { id: 'DELIVERED', label: 'Delivered' },
];

const STATUS_BADGE: Record<
  EmailMessageStatus,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' | 'default' }
> = {
  QUEUED: { label: 'Queued', variant: 'default' },
  SENDING: { label: 'Sending', variant: 'default' },
  // Accepted is the provider taking it, not the inbox receiving it.
  ACCEPTED: { label: 'Accepted by provider', variant: 'outline' },
  DELAYED: { label: 'Delayed', variant: 'warning' },
  DELIVERED: { label: 'Delivered', variant: 'success' },
  BOUNCED: { label: 'Bounced', variant: 'destructive' },
  COMPLAINED: { label: 'Marked as spam', variant: 'destructive' },
  FAILED: { label: 'Failed', variant: 'destructive' },
  SUPPRESSED: { label: 'Suppressed', variant: 'warning' },
  SKIPPED: { label: 'Not sent (switched off)', variant: 'outline' },
};

function EmailLog() {
  const queryClient = useQueryClient();
  const canRetry = useHasPermission('email:manage');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: '50' });
  if (filter !== 'ALL') params.set('status', filter);
  if (search.trim()) params.set('q', search.trim());

  const stats = useQuery({
    queryKey: ['admin-email-stats'],
    queryFn: () => api.get<EmailStats>('/admin/emails/stats?hours=168'),
  });
  const log = useQuery({
    queryKey: ['admin-emails', params.toString()],
    queryFn: () => api.get<Paginated<AdminEmailRow>>(`/admin/emails?${params.toString()}`),
    placeholderData: (previous) => previous,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/admin/emails/${id}/retry`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-emails'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-email-stats'] });
    },
  });

  const by = stats.data?.byStatus ?? {};
  const items = log.data?.items ?? [];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Emails</h1>
        <p className="mt-1 text-muted-foreground">
          Every account, security and notification email the platform sent, and what happened to
          it. <em>Accepted</em> means the provider took the message; only a delivery event marks
          it <em>delivered</em>. CRM email is tracked in each CRM.
        </p>
        {stats.data ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Sending with: <strong>{stats.data.driver}</strong>
            {stats.data.driver === 'log' ? ' — nothing leaves the server.' : ''}
          </p>
        ) : null}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sent (7 days)" value={stats.data?.total ?? '—'} icon={Send} />
        <StatTile label="Delivered" value={by.DELIVERED ?? 0} icon={CheckCheck} />
        <StatTile
          label="Failed or bounced"
          value={(by.FAILED ?? 0) + (by.BOUNCED ?? 0) + (by.COMPLAINED ?? 0)}
          icon={MailWarning}
        />
        <StatTile label="Needed a retry" value={stats.data?.retried ?? 0} icon={RotateCcw} />
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === filter}
              onClick={() => {
                setFilter(entry.id);
                setPage(1);
              }}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                entry.id === filter
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <Input
          type="search"
          placeholder="Search by recipient"
          aria-label="Search by recipient"
          className="w-full sm:w-64"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <ErrorAlert error={log.error ?? stats.error ?? retry.error} className="mb-4" />

      {log.isPending ? (
        <Spinner label="Loading emails" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-8 w-8" aria-hidden />}
            title="No emails here"
            description="Verification, password and notification emails appear here as they are sent."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {items.map((email) => {
            const badge = STATUS_BADGE[email.status];
            return (
              <div key={email.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{email.subject}</span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <Badge variant="outline">{email.category.toLowerCase()}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    To {email.toEmail} · {email.templateKey}
                    {email.attempts > 1 ? ` · ${email.attempts} attempts` : ''}
                  </p>
                  {email.lastError &&
                  ['FAILED', 'BOUNCED', 'COMPLAINED', 'DELAYED', 'SUPPRESSED', 'SKIPPED'].includes(
                    email.status,
                  ) ? (
                    <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      <span>
                        {email.lastErrorCode ? `${email.lastErrorCode}: ` : ''}
                        {email.lastError}
                      </span>
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(email.createdAt)}
                  </span>
                  {canRetry && email.retryable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={retry.isPending && retry.variables === email.id}
                      onClick={() => retry.mutate(email.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      Retry
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <Pagination page={page} totalPages={log.data?.totalPages ?? 1} onChange={setPage} />
    </>
  );
}

export default function AdminEmailsPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <EmailLog />
      </div>
    </RequireAuth>
  );
}
