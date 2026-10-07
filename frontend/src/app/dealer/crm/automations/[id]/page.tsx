'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCrm } from '@/components/crm/context';
import { AutomationBuilder } from '@/components/crm/automation-builder';
import {
  DataTable,
  PageHeader,
  Section,
  StatusPill,
  useCrmMutation,
  useCrmQuery,
} from '@/components/crm/ui';
import { Button } from '@/components/ui';
import { crm, dateTime, humanize, personName } from '@/lib/crm';

interface Enrollment {
  id: string;
  status: string;
  currentStepId: string | null;
  nextRunAt: string | null;
  stopReason: string | null;
  lastError: string | null;
  attempts: number;
  startedAt: string;
  lead: { id: string; number: number; firstName: string; lastName: string | null } | null;
}

export default function AutomationPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can, dealerId } = useCrm();
  const enrollments = useCrmQuery<Enrollment[]>(
    ['enrollments', id],
    `/automations/${id}/enrollments`,
    id !== 'new',
  );
  const stop = useCrmMutation((enrollmentId: string) =>
    crm.post(`/enrollments/${enrollmentId}/stop`),
  );
  const retry = useCrmMutation((enrollmentId: string) =>
    crm.post(`/enrollments/${enrollmentId}/retry`),
  );
  return (
    <>
      <p className="mb-1 text-sm text-muted-foreground">
        <Link href="/dealer/crm/automations" className="hover:underline">
          Automations
        </Link>
      </p>
      <PageHeader title={id === 'new' ? 'New automation' : 'Automation'} />
      <AutomationBuilder
        api={crm}
        id={id}
        queryKey={['crm', dealerId]}
        backHref="/dealer/crm/automations"
        scope="DEALER"
        people={me.staff.map((person) => ({ id: person.id, name: personName(person) }))}
        statuses={me.statuses.map((status) => ({ key: status.key, label: status.label }))}
        canEdit={can('crm.automations')}
      />
      {id !== 'new' ? (
        <Section title="Leads in this automation" className="mt-8">
          <DataTable<Enrollment>
            rows={enrollments.data}
            loading={enrollments.isPending}
            error={enrollments.error ?? stop.error ?? retry.error}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'lead',
                label: 'Lead',
                render: (row) =>
                  row.lead ? (
                    <Link href={`/dealer/crm/leads/${row.lead.id}`} className="hover:underline">
                      {personName(row.lead)}
                    </Link>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'status',
                label: 'Status',
                render: (row) => <StatusPill status={row.status} />,
              },
              { key: 'step', label: 'Step', render: (row) => row.currentStepId ?? '—' },
              { key: 'next', label: 'Next run', render: (row) => dateTime(row.nextRunAt) },
              {
                key: 'why',
                label: 'Note',
                render: (row) => (
                  <span className="text-xs">
                    {row.stopReason ? humanize(row.stopReason) : (row.lastError ?? '')}
                  </span>
                ),
              },
              { key: 'started', label: 'Started', render: (row) => dateTime(row.startedAt) },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (row) =>
                  row.status === 'ACTIVE' || row.status === 'WAITING' ? (
                    <Button size="sm" variant="ghost" onClick={() => stop.mutate(row.id)}>
                      Stop
                    </Button>
                  ) : row.status === 'FAILED' && can('crm.automations') ? (
                    <Button size="sm" variant="ghost" onClick={() => retry.mutate(row.id)}>
                      Retry
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Section>
      ) : null}
    </>
  );
}
