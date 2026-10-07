'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppointmentDialog } from '@/components/crm/forms';
import {
  DataTable,
  LinkButton,
  PageHeader,
  StatusPill,
  Tabs,
  useCrmMutation,
  useCrmQuery,
} from '@/components/crm/ui';
import { Button } from '@/components/ui';
import { crm, dateTime, humanize, personName, qs, type AppointmentRow } from '@/lib/crm';

type View = 'UPCOMING' | 'PAST';

export default function AppointmentsPage() {
  const [view, setView] = useState<View>('UPCOMING');
  const [editing, setEditing] = useState<AppointmentRow | null>(null);
  const range = useMemo(() => {
    const now = Date.now();
    return view === 'UPCOMING'
      ? { from: new Date(now).toISOString(), to: new Date(now + 90 * 86_400_000).toISOString() }
      : { from: new Date(now - 90 * 86_400_000).toISOString(), to: new Date(now).toISOString() };
  }, [view]);
  const list = useCrmQuery<AppointmentRow[]>(['appointments', view], `/appointments${qs(range)}`);
  const setStatus = useCrmMutation((input: { id: string; status: string }) =>
    crm.post(`/appointments/${input.id}/status`, { status: input.status }),
  );
  const rows = view === 'PAST' ? [...(list.data ?? [])].reverse() : list.data;
  return (
    <>
      <PageHeader
        title="Appointments"
        description="Test drives, viewings, appraisals, finance meetings and deliveries. Book one from a lead."
        actions={<LinkButton href="/dealer/crm/calendar">Calendar</LinkButton>}
      />
      <Tabs
        label="Appointments"
        value={view}
        onChange={setView}
        tabs={[
          { id: 'UPCOMING', label: 'Next 90 days' },
          { id: 'PAST', label: 'Last 90 days' },
        ]}
      />
      <DataTable<AppointmentRow>
        rows={rows}
        loading={list.isPending}
        error={list.error ?? setStatus.error}
        rowKey={(row) => row.id}
        columns={[
          { key: 'when', label: 'When', render: (row) => dateTime(row.startsAt) },
          {
            key: 'type',
            label: 'Type',
            render: (row) => (
              <button type="button" className="hover:underline" onClick={() => setEditing(row)}>
                {humanize(row.type)}
              </button>
            ),
          },
          {
            key: 'lead',
            label: 'Customer',
            render: (row) =>
              row.lead ? (
                <Link href={`/dealer/crm/leads/${row.lead.id}`} className="hover:underline">
                  {personName(row.lead)}
                </Link>
              ) : (
                '—'
              ),
          },
          { key: 'vehicle', label: 'Vehicle', render: (row) => row.vehicle?.title ?? '—' },
          { key: 'sales', label: 'Salesperson', render: (row) => personName(row.salesperson) },
          { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) =>
              row.status === 'SCHEDULED' || row.status === 'CONFIRMED' ? (
                <div className="flex justify-end gap-1">
                  {row.status === 'SCHEDULED' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setStatus.mutate({ id: row.id, status: 'CONFIRMED' })}
                    >
                      Confirm
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setStatus.mutate({ id: row.id, status: 'COMPLETED' })}
                  >
                    Done
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setStatus.mutate({ id: row.id, status: 'NO_SHOW' })}
                  >
                    No-show
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />
      <AppointmentDialog open={!!editing} onClose={() => setEditing(null)} appointment={editing} />
    </>
  );
}
