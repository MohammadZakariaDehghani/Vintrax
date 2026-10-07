'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErrorAlert, Spinner } from '@/components/ui';
import { ActivityList, MessageBox, Panel, TaskList, TicketList } from '@/components/crm/support-360';
import { Facts, PageHeader, StatusPill, useSupportQuery } from '@/components/crm/ui';
import { dateTime, humanize, personName, support, type Person } from '@/lib/crm';

interface Dealer360 {
  dealer: {
    id: string;
    name: string;
    slug: string;
    status: string;
    verified: boolean;
    verifiedAt: string | null;
    verificationNote: string | null;
    phone: string | null;
    websiteUrl: string | null;
    city: string | null;
    province: string | null;
    createdAt: string;
    owner: { id: string; email: string; firstName: string; lastName: string; status: string; lastLoginAt: string | null; emailVerified: boolean };
    staff: Array<{ role: string; createdAt: string; user: { id: string; email: string; firstName: string; lastName: string; status: string } }>;
  };
  inventory: Record<string, number>;
  tickets: { open: Array<{ id: string; number: number; subject: string; status: string; priority: string; createdAt: string }>; closed: Array<{ id: string; number: number; subject: string; status: string; priority: string; createdAt: string }> };
  tasks: Array<{ id: string; title: string; status: string; dueAt: string | null; assignedTo: Person | null }>;
  communication: Array<{ id: string; subject: string; status: string; toEmail: string; sentAt: string | null; createdAt: string; ticketId: string | null }>;
  notes: Array<{ id: string; body: string; createdAt: string; ticket: { id: string; number: number }; author: { firstName: string; lastName: string } | null }>;
  activity: Array<{ id: string; action: string; entityType: string; actorEmail: string | null; createdAt: string }>;
  audit: Array<{ id: string; action: string; entityType: string; actorEmail: string | null; createdAt: string }>;
}

/** Dealer 360: the account and everything support has done with it. No financial records, no leads. */
export default function Dealer360Page() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useSupportQuery<Dealer360>(support, ['dealer360', id], `/dealers/${id}`);
  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Spinner />;
  const d = data.dealer;
  return (
    <>
      <p className="mb-1 text-sm text-muted-foreground"><Link href="/admin/crm/dealers" className="hover:underline">Dealers</Link></p>
      <PageHeader title={d.name} description={[d.city, d.province].filter(Boolean).join(', ')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Profile and account">
          <Facts
            items={[
              ['Status', <StatusPill key="s" status={d.status} />],
              ['Verified', d.verified ? `Yes, ${dateTime(d.verifiedAt)}` : 'No'],
              ['Phone', d.phone ?? '—'],
              ['Website', d.websiteUrl ?? '—'],
              ['Joined', dateTime(d.createdAt)],
              ['Owner', <Link key="o" href={`/admin/crm/users/${d.owner.id}`} className="text-primary hover:underline">{personName(d.owner)}</Link>],
              ['Owner email', `${d.owner.email}${d.owner.emailVerified ? '' : ' (unverified)'}`],
              ['Owner last sign-in', dateTime(d.owner.lastLoginAt)],
            ]}
          />
          {d.verificationNote ? <p className="mt-2 text-xs text-muted-foreground">Verification note: {d.verificationNote}</p> : null}
        </Panel>
        <Panel title="Staff">
          {d.staff.length === 0 ? <p className="text-sm text-muted-foreground">Only the owner.</p> : (
            <ul className="space-y-1 text-sm">
              {d.staff.map((member) => (
                <li key={member.user.id}><Link href={`/admin/crm/users/${member.user.id}`} className="hover:underline">{personName(member.user)}</Link> · {humanize(member.role)} · <StatusPill status={member.user.status} /></li>
              ))}
            </ul>
          )}
          <h3 className="mb-1 mt-4 text-sm font-semibold">Inventory</h3>
          <p className="text-sm">{Object.entries(data.inventory).map(([status, count]) => `${humanize(status)}: ${count}`).join(' · ') || 'No vehicles'}</p>
        </Panel>
        <Panel title={`Open tickets (${data.tickets.open.length})`}><TicketList tickets={data.tickets.open} /></Panel>
        <Panel title={`Closed tickets (${data.tickets.closed.length})`}><TicketList tickets={data.tickets.closed} /></Panel>
        <Panel title="Admin tasks"><TaskList tasks={data.tasks} /></Panel>
        <Panel title="Internal notes">
          {data.notes.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <ul className="space-y-2 text-sm">
              {data.notes.map((note) => (
                <li key={note.id} className="rounded-md border border-warning/50 bg-warning/10 p-2">
                  <p className="text-xs text-muted-foreground"><Link href={`/admin/crm/tickets/${note.ticket.id}`} className="hover:underline">#{note.ticket.number}</Link> · {note.author ? personName(note.author) : ''} · {dateTime(note.createdAt)}</p>
                  <p className="whitespace-pre-line">{note.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Communication">
          {data.communication.length === 0 ? <p className="text-sm text-muted-foreground">No emails from support.</p> : (
            <ul className="space-y-1 text-sm">
              {data.communication.map((email) => <li key={email.id}>{email.subject} · <StatusPill status={email.status} /> <span className="text-xs text-muted-foreground">{email.toEmail} · {dateTime(email.sentAt ?? email.createdAt)}</span></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Message the dealer"><MessageBox dealerId={d.id} /></Panel>
        <Panel title="Account activity"><ActivityList items={data.activity} /></Panel>
        <Panel title="Support audit history"><ActivityList items={data.audit} /></Panel>
      </div>
    </>
  );
}
