'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { ADMIN_TASK_TYPES, CRM_PRIORITIES, CRM_TASK_STATUSES } from '@vintrax/shared';
import {
  Button,
  Dialog,
  ErrorAlert,
  Field,
  Input,
  Pagination,
  Select,
  Textarea,
} from '@/components/ui';
import {
  DataTable,
  PageHeader,
  StatusPill,
  Tabs,
  fieldError,
  useCrmMutation,
  useSupportQuery,
} from '@/components/crm/ui';
import {
  dateTime,
  fromLocalInput,
  humanize,
  personName,
  qs,
  support,
  toLocalInput,
  type Paged,
  type Person,
  type SupportSettingsView,
} from '@/lib/crm';

type View = 'OPEN' | 'MINE' | 'OVERDUE' | 'COMPLETED' | 'ALL';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'OPEN', label: 'Open' },
  { id: 'MINE', label: 'Mine' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'ALL', label: 'All' },
];

interface AdminTask {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  reminderAt: string | null;
  overdue: boolean;
  assignedToId: string | null;
  ticketId: string | null;
  dealerId: string | null;
  subjectUserId: string | null;
  assignedTo: Person | null;
  ticket: { id: string; number: number; subject: string } | null;
}

/** Admin tasks: follow-ups, checks and escalations, optionally tied to a ticket, dealer or user. */
export default function AdminCrmTasksPage() {
  const [view, setView] = useState<View>('OPEN');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminTask | 'new' | null>(null);
  const settings = useSupportQuery<SupportSettingsView>(support, ['settings'], '/settings');
  const query = qs({ view, page, pageSize: 25 });
  const list = useSupportQuery<Paged<AdminTask>>(support, ['tasks', query], `/tasks${query}`);
  const complete = useCrmMutation(
    (task: AdminTask) =>
      support.put(`/tasks/${task.id}`, { ...taskBody(task), status: 'COMPLETED' }),
    undefined,
    'support',
  );
  return (
    <>
      <PageHeader
        title="Admin tasks"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden /> New task
          </Button>
        }
      />
      <Tabs
        label="Task views"
        value={view}
        onChange={(next) => {
          setView(next);
          setPage(1);
        }}
        tabs={VIEWS}
      />
      <ErrorAlert error={complete.error} className="mb-3" />
      <DataTable<AdminTask>
        rows={list.data?.items}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'title',
            label: 'Task',
            render: (row) => (
              <div>
                <button
                  type="button"
                  className="text-left font-medium hover:underline"
                  onClick={() => setEditing(row)}
                >
                  {row.title}
                </button>
                <span className="block text-xs text-muted-foreground">
                  {humanize(row.type)}
                  {row.ticket ? (
                    <>
                      {' '}
                      ·{' '}
                      <Link
                        href={`/admin/crm/tickets/${row.ticket.id}`}
                        className="hover:underline"
                      >
                        #{row.ticket.number}
                      </Link>
                    </>
                  ) : null}
                  {row.dealerId ? (
                    <>
                      {' '}
                      ·{' '}
                      <Link href={`/admin/crm/dealers/${row.dealerId}`} className="hover:underline">
                        dealer
                      </Link>
                    </>
                  ) : null}
                  {row.subjectUserId ? (
                    <>
                      {' '}
                      ·{' '}
                      <Link
                        href={`/admin/crm/users/${row.subjectUserId}`}
                        className="hover:underline"
                      >
                        user
                      </Link>
                    </>
                  ) : null}
                </span>
              </div>
            ),
          },
          {
            key: 'priority',
            label: 'Priority',
            render: (row) => <StatusPill status={row.priority} />,
          },
          { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
          { key: 'assigned', label: 'Assigned', render: (row) => personName(row.assignedTo) },
          {
            key: 'due',
            label: 'Due',
            render: (row) => (
              <span className={row.overdue ? 'font-medium text-destructive' : ''}>
                {dateTime(row.dueAt)}
              </span>
            ),
          },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) =>
              row.status === 'OPEN' || row.status === 'IN_PROGRESS' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={complete.isPending && complete.variables?.id === row.id}
                  onClick={() => complete.mutate(row)}
                >
                  Complete
                </Button>
              ) : null,
          },
        ]}
      />
      <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onChange={setPage} />
      <AdminTaskDialog
        task={editing}
        onClose={() => setEditing(null)}
        admins={settings.data?.admins ?? []}
      />
    </>
  );
}

function taskBody(task: AdminTask) {
  return {
    type: task.type,
    title: task.title,
    description: task.description,
    assignedToId: task.assignedToId,
    ticketId: task.ticketId,
    dealerId: task.dealerId,
    subjectUserId: task.subjectUserId,
    dueAt: task.dueAt,
    reminderAt: task.reminderAt,
    priority: task.priority,
    status: task.status,
  };
}

function AdminTaskDialog({
  task,
  onClose,
  admins,
}: {
  task: AdminTask | 'new' | null;
  onClose: () => void;
  admins: SupportSettingsView['admins'];
}) {
  const blank = {
    type: 'OTHER',
    title: '',
    description: '',
    assignedToId: '',
    dueAt: '',
    reminderAt: '',
    priority: 'MEDIUM',
    status: 'OPEN',
  };
  const [form, setForm] = useState(blank);
  const existing = task && task !== 'new' ? task : null;
  useEffect(() => {
    if (!task) return;
    setForm(
      existing
        ? {
            type: existing.type,
            title: existing.title,
            description: existing.description ?? '',
            assignedToId: existing.assignedToId ?? '',
            dueAt: toLocalInput(existing.dueAt),
            reminderAt: toLocalInput(existing.reminderAt),
            priority: existing.priority,
            status: existing.status,
          }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);
  const save = useCrmMutation(
    () => {
      const body = {
        type: form.type,
        title: form.title,
        description: form.description || null,
        assignedToId: form.assignedToId || null,
        ticketId: existing?.ticketId ?? null,
        dealerId: existing?.dealerId ?? null,
        subjectUserId: existing?.subjectUserId ?? null,
        dueAt: fromLocalInput(form.dueAt),
        reminderAt: fromLocalInput(form.reminderAt),
        priority: form.priority,
        status: form.status,
      };
      return existing ? support.put(`/tasks/${existing.id}`, body) : support.post('/tasks', body);
    },
    onClose,
    'support',
  );
  const remove = useCrmMutation(() => support.delete(`/tasks/${existing?.id}`), onClose, 'support');
  return (
    <Dialog
      open={!!task}
      onClose={onClose}
      title={existing ? 'Edit task' : 'New task'}
      footer={
        <>
          {existing ? (
            <Button
              variant="ghost"
              loading={remove.isPending}
              onClick={() => remove.mutate(undefined)}
            >
              Delete
            </Button>
          ) : null}
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Title"
          htmlFor="at-title"
          className="sm:col-span-2"
          error={fieldError(save.error, 'title')}
        >
          <Input
            id="at-title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="Type" htmlFor="at-type">
          <Select
            id="at-type"
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value })}
          >
            {ADMIN_TASK_TYPES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assign to" htmlFor="at-assign">
          <Select
            id="at-assign"
            value={form.assignedToId}
            onChange={(event) => setForm({ ...form, assignedToId: event.target.value })}
          >
            <option value="">Nobody yet</option>
            {admins.map((admin) => (
              <option key={admin.id} value={admin.id}>
                {personName(admin)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="at-priority">
          <Select
            id="at-priority"
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value })}
          >
            {CRM_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="at-status">
          <Select
            id="at-status"
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
          >
            {CRM_TASK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due" htmlFor="at-due" error={fieldError(save.error, 'dueAt')}>
          <Input
            id="at-due"
            type="datetime-local"
            value={form.dueAt}
            onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
          />
        </Field>
        <Field label="Remind me" htmlFor="at-remind" error={fieldError(save.error, 'reminderAt')}>
          <Input
            id="at-remind"
            type="datetime-local"
            value={form.reminderAt}
            onChange={(event) => setForm({ ...form, reminderAt: event.target.value })}
          />
        </Field>
        <Field label="Notes" htmlFor="at-desc" className="sm:col-span-2">
          <Textarea
            id="at-desc"
            rows={3}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
      </div>
      {existing?.ticket ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Linked to ticket{' '}
          <Link href={`/admin/crm/tickets/${existing.ticket.id}`} className="hover:underline">
            #{existing.ticket.number} {existing.ticket.subject}
          </Link>
        </p>
      ) : null}
      <ErrorAlert error={save.error ?? remove.error} className="mt-3" />
    </Dialog>
  );
}
