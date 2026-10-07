'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { CRM_PRIORITIES } from '@vintrax/shared';
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
  humanize,
  personName,
  qs,
  support,
  type Paged,
  type SupportSettingsView,
  type TicketRow,
} from '@/lib/crm';

type View =
  'OPEN' | 'MINE' | 'UNASSIGNED' | 'OVERDUE' | 'WAITING' | 'ESCALATED' | 'RESOLVED' | 'ALL';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'OPEN', label: 'Open' },
  { id: 'MINE', label: 'Mine' },
  { id: 'UNASSIGNED', label: 'Unassigned' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'WAITING', label: 'Waiting' },
  { id: 'ESCALATED', label: 'Escalated' },
  { id: 'RESOLVED', label: 'Resolved' },
  { id: 'ALL', label: 'All' },
];

function Tickets() {
  const params = useSearchParams();
  const [view, setView] = useState<View>((params.get('view') as View) ?? 'OPEN');
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const settings = useSupportQuery<SupportSettingsView>(support, ['settings'], '/settings');
  const query = qs({ view, q, priority, categoryId, page, pageSize: 25 });
  const list = useSupportQuery<Paged<TicketRow>>(
    support,
    ['tickets', query],
    `/tickets${query}`,
    true,
    30_000,
  );
  return (
    <>
      <PageHeader
        title="Tickets"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New ticket
          </Button>
        }
      />
      <Tabs
        label="Ticket views"
        value={view}
        onChange={(next) => {
          setView(next);
          setPage(1);
        }}
        tabs={VIEWS}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Search tickets"
          placeholder="Subject, email, dealer, #"
          className="max-w-xs"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Priority"
          className="w-40"
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Any priority</option>
          {CRM_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Category"
          className="w-48"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Any category</option>
          {settings.data?.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </Select>
      </div>
      <DataTable<TicketRow>
        rows={list.data?.items}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          { key: 'number', label: '#', render: (row) => row.number },
          {
            key: 'subject',
            label: 'Subject',
            render: (row) => (
              <div>
                <Link href={`/admin/crm/tickets/${row.id}`} className="font-medium hover:underline">
                  {row.subject}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {row.requesterName ?? row.requesterEmail}
                  {row.dealer ? ` · ${row.dealer.name}` : ''}
                  {row.lastPublicReplyBy === 'REQUESTER' ? ' · awaiting our reply' : ''}
                </span>
              </div>
            ),
          },
          { key: 'category', label: 'Category', render: (row) => row.category?.label ?? '—' },
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
          { key: 'updated', label: 'Updated', render: (row) => dateTime(row.updatedAt) },
        ]}
      />
      <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onChange={setPage} />
      <NewTicketDialog
        open={creating}
        onClose={() => setCreating(false)}
        settings={settings.data}
      />
    </>
  );
}

function NewTicketDialog({
  open,
  onClose,
  settings,
}: {
  open: boolean;
  onClose: () => void;
  settings?: SupportSettingsView;
}) {
  const router = useRouter();
  const blank = {
    requesterEmail: '',
    requesterName: '',
    subject: '',
    description: '',
    categoryId: '',
    priority: 'MEDIUM',
    assignedToId: '',
    tags: '',
  };
  const [form, setForm] = useState(blank);
  useEffect(() => {
    if (open) setForm(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const create = useCrmMutation(
    () =>
      support.post<{ id: string }>('/tickets', {
        requesterEmail: form.requesterEmail,
        requesterName: form.requesterName || null,
        subject: form.subject,
        description: form.description,
        categoryId: form.categoryId || null,
        priority: form.priority,
        assignedToId: form.assignedToId || null,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    (ticket) => {
      onClose();
      router.push(`/admin/crm/tickets/${ticket.id}`);
    },
    'support',
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New ticket"
      description="For a user or dealer who reached you another way. If the email belongs to an account, the ticket is linked to it."
      footer={
        <Button loading={create.isPending} onClick={() => create.mutate(undefined)}>
          Create ticket
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Requester email"
          htmlFor="nt-email"
          error={fieldError(create.error, 'requesterEmail')}
        >
          <Input
            id="nt-email"
            type="email"
            value={form.requesterEmail}
            onChange={(event) => setForm({ ...form, requesterEmail: event.target.value })}
          />
        </Field>
        <Field label="Name" htmlFor="nt-name">
          <Input
            id="nt-name"
            value={form.requesterName}
            onChange={(event) => setForm({ ...form, requesterName: event.target.value })}
          />
        </Field>
        <Field
          label="Subject"
          htmlFor="nt-subject"
          className="sm:col-span-2"
          error={fieldError(create.error, 'subject')}
        >
          <Input
            id="nt-subject"
            value={form.subject}
            onChange={(event) => setForm({ ...form, subject: event.target.value })}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="nt-desc"
          className="sm:col-span-2"
          error={fieldError(create.error, 'description')}
        >
          <Textarea
            id="nt-desc"
            rows={4}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        <Field label="Category" htmlFor="nt-cat">
          <Select
            id="nt-cat"
            value={form.categoryId}
            onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
          >
            <option value="">—</option>
            {settings?.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="nt-priority">
          <Select
            id="nt-priority"
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
        <Field label="Assign to" htmlFor="nt-assign">
          <Select
            id="nt-assign"
            value={form.assignedToId}
            onChange={(event) => setForm({ ...form, assignedToId: event.target.value })}
          >
            <option value="">Automatically</option>
            {settings?.admins.map((admin) => (
              <option key={admin.id} value={admin.id}>
                {personName(admin)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags" htmlFor="nt-tags">
          <Input
            id="nt-tags"
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
          />
        </Field>
      </div>
      <ErrorAlert error={create.error} className="mt-3" />
    </Dialog>
  );
}

export default function TicketsPage() {
  return (
    <Suspense>
      <Tickets />
    </Suspense>
  );
}
