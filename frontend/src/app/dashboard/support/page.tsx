'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy, Plus } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { StatusPill, fieldError, useCrmMutation } from '@/components/crm/ui';
import { dateTime, portal } from '@/lib/crm';

interface MyTicket {
  id: string;
  number: number;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastPublicReplyAt: string | null;
  lastPublicReplyBy: string | null;
  category: { label: string } | null;
}

function Support() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', description: '', categoryId: '' });
  const tickets = useQuery({
    queryKey: ['portal', 'tickets'],
    queryFn: ({ signal }) => portal.get<MyTicket[]>('/tickets', signal),
  });
  const categories = useQuery({
    queryKey: ['portal', 'categories'],
    queryFn: ({ signal }) =>
      portal.get<Array<{ id: string; label: string }>>('/categories', signal),
    enabled: open,
  });
  const create = useCrmMutation(
    () =>
      portal.post<{ id: string }>('/tickets', {
        subject: form.subject,
        description: form.description,
        categoryId: form.categoryId || null,
      }),
    (ticket) => router.push(`/dashboard/support/${ticket.id}`),
    'portal',
  );
  return (
    <div className="container py-8">
      <DashboardNav />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support</h1>
          <p className="text-muted-foreground">Ask Vintrax for help. We reply here and by email.</p>
        </div>
        {!open ? (
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New request
          </Button>
        ) : null}
      </div>
      {open ? (
        <Card className="mb-6">
          <CardContent className="space-y-3 pt-4">
            <Field label="Subject" htmlFor="st-subject" error={fieldError(create.error, 'subject')}>
              <Input
                id="st-subject"
                value={form.subject}
                onChange={(event) => setForm({ ...form, subject: event.target.value })}
              />
            </Field>
            <Field label="Topic" htmlFor="st-category">
              <Select
                id="st-category"
                value={form.categoryId}
                onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
              >
                <option value="">Choose one (optional)</option>
                {categories.data?.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="How can we help?"
              htmlFor="st-description"
              error={fieldError(create.error, 'description')}
            >
              <Textarea
                id="st-description"
                rows={6}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                loading={create.isPending}
                disabled={!form.subject.trim() || !form.description.trim()}
                onClick={() => create.mutate(undefined)}
              >
                Send
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <ErrorAlert error={create.error} />
          </CardContent>
        </Card>
      ) : null}
      <ErrorAlert error={tickets.error} />
      {tickets.isPending ? <Spinner /> : null}
      {tickets.data && tickets.data.length === 0 && !open ? (
        <EmptyState
          icon={<LifeBuoy className="h-8 w-8" aria-hidden />}
          title="No requests yet"
          description="If something isn't working or you have a question, open a request."
        />
      ) : null}
      {tickets.data && tickets.data.length > 0 ? (
        <Card>
          <ul className="divide-y divide-border">
            {tickets.data.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/dashboard/support/${ticket.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-secondary/50"
                >
                  <span>
                    <span className="font-medium">
                      #{ticket.number} {ticket.subject}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {ticket.category?.label ? `${ticket.category.label} · ` : ''}Updated{' '}
                      {dateTime(ticket.updatedAt)}
                      {ticket.lastPublicReplyBy === 'ADMIN' ? ' · support replied' : ''}
                    </span>
                  </span>
                  <StatusPill status={ticket.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export default function SupportPage() {
  return (
    <RequireAuth>
      <Support />
    </RequireAuth>
  );
}
