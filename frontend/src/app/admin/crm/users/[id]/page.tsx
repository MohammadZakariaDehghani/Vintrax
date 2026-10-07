'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErrorAlert, Spinner } from '@/components/ui';
import {
  ActivityList,
  MessageBox,
  Panel,
  TaskList,
  TicketList,
} from '@/components/crm/support-360';
import { Facts, PageHeader, StatusPill, useSupportQuery } from '@/components/crm/ui';
import { dateTime, humanize, personName, support, type Person } from '@/lib/crm';

interface User360 {
  user: {
    id: string;
    email: string;
    username: string | null;
    firstName: string;
    lastName: string;
    phone: string | null;
    city: string | null;
    role: string;
    status: string;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    lastLoginAt: string | null;
    createdAt: string;
    dealer: { id: string; name: string; status: string; verified: boolean } | null;
  };
  memberships: Array<{ role: string; dealer: { id: string; name: string } }>;
  listings: number;
  tickets: {
    open: Array<{
      id: string;
      number: number;
      subject: string;
      status: string;
      priority: string;
      createdAt: string;
    }>;
    closed: Array<{
      id: string;
      number: number;
      subject: string;
      status: string;
      priority: string;
      createdAt: string;
    }>;
  };
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueAt: string | null;
    assignedTo: Person | null;
  }>;
  communication: {
    emails: Array<{
      id: string;
      subject: string;
      status: string;
      sentAt: string | null;
      createdAt: string;
      ticketId: string | null;
    }>;
    notifications: Array<{ id: string; title: string; createdAt: string; readAt: string | null }>;
  };
  activity: Array<{
    id: string;
    action: string;
    entityType: string;
    actorEmail: string | null;
    createdAt: string;
  }>;
}

/** User 360: the account, its dealership ties, tickets, communication and activity. */
export default function User360Page() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useSupportQuery<User360>(support, ['user360', id], `/users/${id}`);
  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Spinner />;
  const u = data.user;
  return (
    <>
      <p className="mb-1 text-sm text-muted-foreground">
        <Link href="/admin/crm/users" className="hover:underline">
          Users
        </Link>
      </p>
      <PageHeader title={personName(u)} description={u.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Profile and account">
          <Facts
            items={[
              ['Role', humanize(u.role)],
              ['Status', <StatusPill key="s" status={u.status} />],
              ['Email verified', u.emailVerified ? `Yes, ${dateTime(u.emailVerifiedAt)}` : 'No'],
              ['Username', u.username ?? '—'],
              ['Phone', u.phone ?? '—'],
              ['City', u.city ?? '—'],
              ['Joined', dateTime(u.createdAt)],
              ['Last sign-in', dateTime(u.lastLoginAt)],
              ['Listings', String(data.listings)],
            ]}
          />
        </Panel>
        <Panel title="Dealer association">
          {u.dealer ? (
            <p className="text-sm">
              Owns{' '}
              <Link
                href={`/admin/crm/dealers/${u.dealer.id}`}
                className="text-primary hover:underline"
              >
                {u.dealer.name}
              </Link>{' '}
              · <StatusPill status={u.dealer.status} />
              {u.dealer.verified ? ' · verified' : ' · not verified'}
            </p>
          ) : null}
          {data.memberships.map((membership) => (
            <p key={membership.dealer.id} className="text-sm">
              {humanize(membership.role)} at{' '}
              <Link
                href={`/admin/crm/dealers/${membership.dealer.id}`}
                className="text-primary hover:underline"
              >
                {membership.dealer.name}
              </Link>
            </p>
          ))}
          {!u.dealer && data.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dealership.</p>
          ) : null}
        </Panel>
        <Panel title={`Open tickets (${data.tickets.open.length})`}>
          <TicketList tickets={data.tickets.open} />
        </Panel>
        <Panel title={`Closed tickets (${data.tickets.closed.length})`}>
          <TicketList tickets={data.tickets.closed} />
        </Panel>
        <Panel title="Admin tasks about this user">
          <TaskList tasks={data.tasks} />
        </Panel>
        <Panel title="Communication">
          <ul className="space-y-1 text-sm">
            {data.communication.emails.map((email) => (
              <li key={email.id}>
                Email: {email.subject} · <StatusPill status={email.status} />{' '}
                <span className="text-xs text-muted-foreground">
                  {dateTime(email.sentAt ?? email.createdAt)}
                </span>
              </li>
            ))}
            {data.communication.notifications.map((note) => (
              <li key={note.id}>
                In-app: {note.title}{' '}
                <span className="text-xs text-muted-foreground">
                  {dateTime(note.createdAt)}
                  {note.readAt ? ' · read' : ''}
                </span>
              </li>
            ))}
            {!data.communication.emails.length && !data.communication.notifications.length ? (
              <li className="text-muted-foreground">None.</li>
            ) : null}
          </ul>
        </Panel>
        <Panel title="Message this user">
          <MessageBox userId={u.id} />
        </Panel>
        <Panel title="Activity">
          <ActivityList items={data.activity} />
        </Panel>
      </div>
    </>
  );
}
