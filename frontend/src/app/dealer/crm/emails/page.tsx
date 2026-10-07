'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button, Dialog, ErrorAlert, Input, Pagination, Select, Spinner } from '@/components/ui';
import {
  DataTable,
  PageHeader,
  StatusPill,
  useCrmMutation,
  useCrmQuery,
} from '@/components/crm/ui';
import { crm, dateTime, humanize, personName, qs, type EmailRow, type Paged } from '@/lib/crm';

interface EmailDetail extends EmailRow {
  bodyHtml: string;
  bodyText: string;
  fromName: string | null;
  replyTo: string | null;
  events: Array<{ id: string; type: string; detail: string | null; createdAt: string }>;
  template: { id: string; name: string } | null;
}

const STATUSES = [
  'SCHEDULED',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'BOUNCED',
  'SUPPRESSED',
  'CANCELLED',
];

function EmailsList() {
  const params = useSearchParams();
  const leadId = params.get('leadId') ?? '';
  const [status, setStatus] = useState('');
  const [purpose, setPurpose] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = qs({ status, purpose, q, leadId, page, pageSize: 25 });
  const list = useCrmQuery<Paged<EmailRow>>(['emails', query], `/emails${query}`, true, 15_000);
  return (
    <>
      <PageHeader
        title="Emails"
        description="Every email the CRM has sent, scheduled or held back — by people, automations and campaigns. Sending happens in the background; failed sends are retried."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Search emails"
          placeholder="Subject or address"
          className="max-w-xs"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Status"
          className="w-44"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Any status</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Kind"
          className="w-44"
          value={purpose}
          onChange={(event) => {
            setPurpose(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Any kind</option>
          <option value="TRANSACTIONAL">Transactional</option>
          <option value="MARKETING">Marketing</option>
        </Select>
        {leadId ? (
          <Link
            href="/dealer/crm/emails"
            className="self-center text-sm text-primary hover:underline"
          >
            Show all leads
          </Link>
        ) : null}
      </div>
      <DataTable<EmailRow>
        rows={list.data?.items}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'subject',
            label: 'Subject',
            render: (row) => (
              <button
                type="button"
                className="text-left font-medium hover:underline"
                onClick={() => setOpenId(row.id)}
              >
                {row.subject}
              </button>
            ),
          },
          {
            key: 'to',
            label: 'To',
            render: (row) =>
              row.lead ? (
                <Link href={`/dealer/crm/leads/${row.lead.id}`} className="hover:underline">
                  {personName(row.lead)}
                </Link>
              ) : (
                row.toEmail
              ),
          },
          { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
          {
            key: 'engagement',
            label: 'Engagement',
            render: (row) => (
              <span className="text-xs text-muted-foreground">
                {[
                  row.openedAt && 'Opened',
                  row.clickedAt && 'Clicked',
                  row.repliedAt && 'Replied',
                  row.bouncedAt && 'Bounced',
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            ),
          },
          {
            key: 'origin',
            label: 'From',
            render: (row) =>
              row.campaign
                ? `Campaign: ${row.campaign.name}`
                : row.enrollmentId
                  ? 'Automation'
                  : 'Person',
          },
          { key: 'kind', label: 'Kind', render: (row) => humanize(row.purpose) },
          { key: 'when', label: 'When', render: (row) => dateTime(row.sentAt ?? row.scheduledAt) },
        ]}
      />
      <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onChange={setPage} />
      <EmailDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function EmailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const email = useCrmQuery<EmailDetail>(['email', id], `/emails/${id}`, !!id);
  const cancel = useCrmMutation(() => crm.post(`/emails/${id}/cancel`));
  const retry = useCrmMutation(() => crm.post(`/emails/${id}/retry`));
  const replied = useCrmMutation(() => crm.post(`/emails/${id}/replied`));
  const data = email.data && email.data.id === id ? email.data : null;
  return (
    <Dialog
      open={!!id}
      onClose={onClose}
      title={data?.subject ?? 'Email'}
      size="lg"
      footer={
        data ? (
          <>
            {data.status === 'SCHEDULED' || data.status === 'QUEUED' ? (
              <Button
                variant="outline"
                loading={cancel.isPending}
                onClick={() => cancel.mutate(undefined)}
              >
                Cancel sending
              </Button>
            ) : null}
            {data.status === 'FAILED' ? (
              <Button
                variant="outline"
                loading={retry.isPending}
                onClick={() => retry.mutate(undefined)}
              >
                Try again
              </Button>
            ) : null}
            {(data.status === 'SENT' || data.status === 'DELIVERED') && !data.repliedAt ? (
              <Button
                variant="outline"
                loading={replied.isPending}
                onClick={() => replied.mutate(undefined)}
              >
                They replied
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      <ErrorAlert error={email.error ?? cancel.error ?? retry.error ?? replied.error} />
      {!data ? (
        <Spinner />
      ) : (
        <>
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">To</dt>
            <dd>{data.toName ? `${data.toName} <${data.toEmail}>` : data.toEmail}</dd>
            <dt className="text-muted-foreground">From</dt>
            <dd>
              {data.fromName ?? '—'}
              {data.replyTo ? ` (replies to ${data.replyTo})` : ''}
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusPill status={data.status} />{' '}
              {data.attempts ? `after ${data.attempts} attempt(s)` : ''}{' '}
              {data.provider ? `via ${data.provider}` : ''}
            </dd>
            <dt className="text-muted-foreground">Kind</dt>
            <dd>
              {humanize(data.purpose)}
              {data.template ? ` · template “${data.template.name}”` : ''}
            </dd>
            {data.lastError ? (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd className="text-destructive">{data.lastError}</dd>
              </>
            ) : null}
          </dl>
          {/* Sanitised on the server when the email was composed. */}
          <div
            className="prose prose-sm max-w-none rounded-md border border-border p-3"
            dangerouslySetInnerHTML={{ __html: data.bodyHtml }}
          />
          <h3 className="mb-1 mt-4 text-sm font-semibold">Delivery events</h3>
          <ul className="space-y-0.5 text-xs">
            {data.events.map((event) => (
              <li key={event.id}>
                <span className="text-muted-foreground">{dateTime(event.createdAt)}</span> ·{' '}
                {humanize(event.type)}
                {event.detail ? ` — ${event.detail}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

export default function EmailsPage() {
  return (
    <Suspense>
      <EmailsList />
    </Suspense>
  );
}
