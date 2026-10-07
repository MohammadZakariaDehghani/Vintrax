'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui';
import { AutomationBuilder } from '@/components/crm/automation-builder';
import { DataTable, PageHeader, Section, StatusPill, useCrmMutation, useSupportQuery } from '@/components/crm/ui';
import { dateTime, humanize, personName, support, type SupportSettingsView } from '@/lib/crm';

interface Enrollment {
  id: string;
  status: string;
  currentStepId: string | null;
  nextRunAt: string | null;
  stopReason: string | null;
  lastError: string | null;
  startedAt: string;
  ticket: { id: string; number: number; subject: string } | null;
}

export default function AdminCrmAutomationPage() {
  const { id } = useParams<{ id: string }>();
  const settings = useSupportQuery<SupportSettingsView>(support, ['settings'], '/settings');
  const enrollments = useSupportQuery<Enrollment[]>(support, ['enrollments', id], `/automations/${id}/enrollments`, id !== 'new');
  const stop = useCrmMutation((enrollmentId: string) => support.post(`/enrollments/${enrollmentId}/stop`), undefined, 'support');
  return (
    <>
      <p className="mb-1 text-sm text-muted-foreground">
        <Link href="/admin/crm/automations" className="hover:underline">Automations</Link>
      </p>
      <PageHeader title={id === 'new' ? 'New support automation' : 'Support automation'} />
      <AutomationBuilder
        api={support}
        id={id}
        queryKey={['support']}
        backHref="/admin/crm/automations"
        scope="SUPPORT"
        people={(settings.data?.admins ?? []).map((admin) => ({ id: admin.id, name: personName(admin) }))}
        statuses={[]}
        canEdit
      />
      {id !== 'new' ? (
        <Section title="Tickets in this automation" className="mt-8">
          <DataTable<Enrollment>
            rows={enrollments.data}
            loading={enrollments.isPending}
            error={enrollments.error ?? stop.error}
            rowKey={(row) => row.id}
            columns={[
              { key: 'ticket', label: 'Ticket', render: (row) => (row.ticket ? <Link href={`/admin/crm/tickets/${row.ticket.id}`} className="hover:underline">#{row.ticket.number} {row.ticket.subject}</Link> : '—') },
              { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
              { key: 'step', label: 'Step', render: (row) => row.currentStepId ?? '—' },
              { key: 'next', label: 'Next run', render: (row) => dateTime(row.nextRunAt) },
              { key: 'why', label: 'Note', render: (row) => <span className="text-xs">{row.stopReason ? humanize(row.stopReason) : row.lastError ?? ''}</span> },
              { key: 'started', label: 'Started', render: (row) => dateTime(row.startedAt) },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (row) => (row.status === 'ACTIVE' || row.status === 'WAITING' ? <Button size="sm" variant="ghost" onClick={() => stop.mutate(row.id)}>Stop</Button> : null),
              },
            ]}
          />
        </Section>
      ) : null}
    </>
  );
}
