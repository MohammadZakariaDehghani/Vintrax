'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { Button, Pagination, Select } from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import { TaskDialog } from '@/components/crm/forms';
import { DataTable, PageHeader, StatusPill, Tabs, useCrmMutation, useCrmQuery } from '@/components/crm/ui';
import { crm, dateTime, humanize, personName, qs, type Paged, type TaskRow } from '@/lib/crm';

type View = 'TODAY' | 'OVERDUE' | 'UPCOMING' | 'OPEN' | 'COMPLETED' | 'ALL';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'TODAY', label: 'Today' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'UPCOMING', label: 'Upcoming' },
  { id: 'OPEN', label: 'All open' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'ALL', label: 'Everything' },
];

export default function TasksPage() {
  const { me, can } = useCrm();
  const [view, setView] = useState<View>('TODAY');
  const [assignee, setAssignee] = useState(can('crm.all_leads') ? '' : 'me');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [open, setOpen] = useState(false);
  const query = qs({ view, assignedToId: assignee, page, pageSize: 50 });
  const list = useCrmQuery<Paged<TaskRow>>(['tasks', query], `/tasks${query}`);
  const setStatus = useCrmMutation((input: { id: string; status: string }) => crm.post(`/tasks/${input.id}/status`, { status: input.status }));
  return (
    <>
      <PageHeader
        title="Tasks"
        description="Follow-ups, calls and to-dos. Overdue tasks notify their owner."
        actions={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4" aria-hidden /> New task
          </Button>
        }
      />
      <Tabs label="Task views" value={view} onChange={(next) => { setView(next); setPage(1); }} tabs={VIEWS} />
      {can('crm.all_leads') ? (
        <Select aria-label="Assigned to" className="mb-4 w-56" value={assignee} onChange={(event) => { setAssignee(event.target.value); setPage(1); }}>
          <option value="">Everyone</option>
          <option value="me">Mine</option>
          <option value="unassigned">Unassigned</option>
          {me.staff.map((person) => (
            <option key={person.id} value={person.id}>{personName(person)}</option>
          ))}
        </Select>
      ) : null}
      <DataTable<TaskRow>
        rows={list.data?.items}
        loading={list.isPending}
        error={list.error ?? setStatus.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'title',
            label: 'Task',
            render: (row) => (
              <button type="button" className="text-left hover:underline" onClick={() => { setEditing(row); setOpen(true); }}>
                <span className="font-medium">{row.title}</span>
                {row.recurrence !== 'NONE' ? <span className="ml-1 text-xs text-muted-foreground">({humanize(row.recurrence)})</span> : null}
              </button>
            ),
          },
          {
            key: 'lead',
            label: 'Lead',
            render: (row) =>
              row.lead ? (
                <Link href={`/dealer/crm/leads/${row.lead.id}`} className="hover:underline">
                  {personName(row.lead)}
                  {row.lead.phone ? <span className="block text-xs text-muted-foreground">{row.lead.phone}</span> : null}
                </Link>
              ) : (
                '—'
              ),
          },
          { key: 'due', label: 'Due', render: (row) => <span className={row.overdue ? 'font-medium text-destructive' : ''}>{dateTime(row.dueAt)}</span> },
          { key: 'priority', label: 'Priority', render: (row) => <StatusPill status={row.priority} /> },
          { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.overdue ? 'FAILED' : row.status} /> },
          { key: 'who', label: 'Assigned', render: (row) => personName(row.assignedTo) },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) =>
              row.status === 'OPEN' || row.status === 'IN_PROGRESS' ? (
                <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: row.id, status: 'COMPLETED' })}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Done
                </Button>
              ) : null,
          },
        ]}
      />
      <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onChange={setPage} />
      <TaskDialog open={open} onClose={() => setOpen(false)} task={editing} />
    </>
  );
}
