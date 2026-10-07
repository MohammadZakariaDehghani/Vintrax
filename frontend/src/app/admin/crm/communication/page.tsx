'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Input, Pagination, Select } from '@/components/ui';
import { MessageBox, Panel } from '@/components/crm/support-360';
import { DataTable, PageHeader, StatusPill, useSupportQuery } from '@/components/crm/ui';
import { dateTime, personName, qs, support } from '@/lib/crm';

interface LoggedEmail {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
  lastError: string | null;
  ticket: { id: string; number: number } | null;
}

interface Recipient {
  id: string;
  name: string;
  detail: string;
}

/** Message a user or a dealer, and the log of every email support has sent. */
export default function AdminCrmCommunicationPage() {
  const [kind, setKind] = useState<'user' | 'dealer'>('user');
  const [q, setQ] = useState('');
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const log = useSupportQuery<LoggedEmail[]>(
    support,
    ['communication', page],
    `/communication${qs({ page, pageSize })}`,
  );
  const users = useSupportQuery<
    Array<{ id: string; email: string; firstName: string; lastName: string }>
  >(support, ['users', q], `/users${qs({ q })}`, kind === 'user' && q.trim().length > 1);
  const dealers = useSupportQuery<Array<{ id: string; name: string; owner: { email: string } }>>(
    support,
    ['dealers', q],
    `/dealers${qs({ q })}`,
    kind === 'dealer' && q.trim().length > 1,
  );
  const matches: Recipient[] =
    kind === 'user'
      ? (users.data ?? []).map((user) => ({
          id: user.id,
          name: personName(user),
          detail: user.email,
        }))
      : (dealers.data ?? []).map((dealer) => ({
          id: dealer.id,
          name: dealer.name,
          detail: dealer.owner.email,
        }));
  return (
    <>
      <PageHeader
        title="Communication"
        description="Email or notify a user or a dealer's owner in the app. Every email sent by support is logged below."
      />
      <Panel title="New message" className="mb-6">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Select
            aria-label="Recipient type"
            className="w-36"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as 'user' | 'dealer');
              setRecipient(null);
            }}
          >
            <option value="user">A user</option>
            <option value="dealer">A dealer</option>
          </Select>
          <Input
            type="search"
            aria-label={kind === 'user' ? 'Find a user' : 'Find a dealer'}
            placeholder={kind === 'user' ? 'Name or email' : 'Dealer name or owner email'}
            className="w-72"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        {q.trim().length > 1 && !recipient ? (
          <ul className="mb-3 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm">
            {matches.length === 0 ? (
              <li className="p-2 text-muted-foreground">No matches.</li>
            ) : null}
            {matches.slice(0, 20).map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  className="w-full p-2 text-left hover:bg-secondary"
                  onClick={() => setRecipient(match)}
                >
                  {match.name} <span className="text-xs text-muted-foreground">{match.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {recipient ? (
          <>
            <p className="mb-2 text-sm">
              To <strong>{recipient.name}</strong>{' '}
              <span className="text-muted-foreground">{recipient.detail}</span>{' '}
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setRecipient(null)}
              >
                change
              </button>
            </p>
            <MessageBox
              key={recipient.id}
              userId={kind === 'user' ? recipient.id : undefined}
              dealerId={kind === 'dealer' ? recipient.id : undefined}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Search for a recipient first.</p>
        )}
      </Panel>
      <DataTable<LoggedEmail>
        rows={log.data}
        loading={log.isPending}
        error={log.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'to',
            label: 'To',
            render: (row) => (
              <span>
                {row.toName ?? row.toEmail}
                <span className="block text-xs text-muted-foreground">{row.toEmail}</span>
              </span>
            ),
          },
          { key: 'subject', label: 'Subject', render: (row) => row.subject },
          {
            key: 'ticket',
            label: 'Ticket',
            render: (row) =>
              row.ticket ? (
                <Link href={`/admin/crm/tickets/${row.ticket.id}`} className="hover:underline">
                  #{row.ticket.number}
                </Link>
              ) : (
                '—'
              ),
          },
          {
            key: 'status',
            label: 'Status',
            render: (row) => (
              <span>
                <StatusPill status={row.status} />
                {row.lastError ? (
                  <span className="block text-xs text-destructive">{row.lastError}</span>
                ) : null}
              </span>
            ),
          },
          { key: 'when', label: 'When', render: (row) => dateTime(row.sentAt ?? row.createdAt) },
        ]}
      />
      <Pagination
        page={page}
        totalPages={log.data && log.data.length === pageSize ? page + 1 : page}
        onChange={setPage}
      />
    </>
  );
}
