'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Card, ErrorAlert, Spinner } from '@/components/ui';
import {
  LinkButton,
  PageHeader,
  Section,
  StatCard,
  StatusPill,
  useSupportQuery,
} from '@/components/crm/ui';
import { dateTime, support } from '@/lib/crm';

interface Overview {
  byStatus: Record<string, number>;
  open: number;
  mine: number;
  unassigned: number;
  overdue: number;
  firstResponseBreached: number;
  tasksOpen: number;
  tasksOverdue: number;
  recent: Array<{
    id: string;
    number: number;
    subject: string;
    status: string;
    priority: string;
    updatedAt: string;
    requesterEmail: string;
  }>;
}

export default function AdminCrmOverviewPage() {
  const { data, error, isPending } = useSupportQuery<Overview>(
    support,
    ['overview'],
    '/overview',
    true,
    30_000,
  );
  return (
    <>
      <PageHeader
        title="Support CRM"
        description="Tickets from users and dealers, the team’s tasks, and every conversation with them."
        actions={
          <LinkButton href="/admin/crm/tickets?new=1" variant="default">
            <Plus className="h-4 w-4" aria-hidden /> New ticket
          </LinkButton>
        }
      />
      <ErrorAlert error={error} />
      {isPending && !data ? <Spinner /> : null}
      {data ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Open tickets" value={data.open} href="/admin/crm/tickets" />
            <StatCard
              label="Assigned to me"
              value={data.mine}
              href="/admin/crm/tickets?view=MINE"
            />
            <StatCard
              label="Unassigned"
              value={data.unassigned}
              tone={data.unassigned ? 'warning' : undefined}
              href="/admin/crm/tickets?view=UNASSIGNED"
            />
            <StatCard
              label="Overdue (SLA)"
              value={data.overdue}
              tone={data.overdue ? 'danger' : undefined}
              href="/admin/crm/tickets?view=OVERDUE"
            />
            <StatCard
              label="First response late"
              value={data.firstResponseBreached}
              tone={data.firstResponseBreached ? 'danger' : undefined}
            />
            <StatCard
              label="Escalated"
              value={data.byStatus.ESCALATED ?? 0}
              href="/admin/crm/tickets?view=ESCALATED"
            />
            <StatCard
              label="Waiting on user/dealer"
              value={
                (data.byStatus.WAITING_FOR_USER ?? 0) + (data.byStatus.WAITING_FOR_DEALER ?? 0)
              }
              href="/admin/crm/tickets?view=WAITING"
            />
            <StatCard
              label="Open tasks"
              value={data.tasksOpen}
              hint={`${data.tasksOverdue} overdue`}
              href="/admin/crm/tasks"
            />
          </div>
          <Section title="Recently updated">
            <Card>
              <ul className="divide-y divide-border">
                {data.recent.length === 0 ? (
                  <li className="px-4 py-6 text-sm text-muted-foreground">No open tickets.</li>
                ) : null}
                {data.recent.map((ticket) => (
                  <li key={ticket.id}>
                    <Link
                      href={`/admin/crm/tickets/${ticket.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-secondary/40"
                    >
                      <span className="text-sm">
                        <span className="text-muted-foreground">#{ticket.number}</span>{' '}
                        <span className="font-medium">{ticket.subject}</span>
                        <span className="block text-xs text-muted-foreground">
                          {ticket.requesterEmail} · {dateTime(ticket.updatedAt)}
                        </span>
                      </span>
                      <span className="flex gap-1">
                        <StatusPill status={ticket.priority} />
                        <StatusPill status={ticket.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        </>
      ) : null}
    </>
  );
}
