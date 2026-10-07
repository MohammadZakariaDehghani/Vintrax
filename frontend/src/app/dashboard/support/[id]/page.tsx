'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, ErrorAlert, Field, Spinner, Textarea } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { StatusPill, useCrmMutation } from '@/components/crm/ui';
import { cn } from '@/lib/utils';
import { dateTime, portal } from '@/lib/crm';

interface MyTicketDetail {
  id: string;
  number: number;
  subject: string;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  category: { label: string } | null;
  messages: Array<{
    id: string;
    from: 'YOU' | 'SUPPORT';
    name: string | null;
    body: string;
    createdAt: string;
  }>;
}

function Ticket() {
  const { id } = useParams<{ id: string }>();
  const [body, setBody] = useState('');
  const ticket = useQuery({
    queryKey: ['portal', 'ticket', id],
    queryFn: ({ signal }) => portal.get<MyTicketDetail>(`/tickets/${id}`, signal),
    refetchInterval: 60_000,
  });
  const reply = useCrmMutation(
    () => portal.post(`/tickets/${id}/replies`, { body }),
    () => setBody(''),
    'portal',
  );
  const data = ticket.data;
  return (
    <div className="container max-w-3xl py-8">
      <DashboardNav />
      <p className="mb-1 text-sm text-muted-foreground">
        <Link href="/dashboard/support" className="hover:underline">
          Support
        </Link>
      </p>
      <ErrorAlert error={ticket.error} />
      {ticket.isPending ? <Spinner /> : null}
      {data ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              #{data.number} {data.subject}
            </h1>
            <StatusPill status={data.status} />
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            {data.category?.label ? `${data.category.label} · ` : ''}Opened{' '}
            {dateTime(data.createdAt)}
          </p>
          <ol className="space-y-3">
            <li>
              <Card>
                <CardContent className="pt-4">
                  <p className="mb-1 text-xs text-muted-foreground">
                    You · {dateTime(data.createdAt)}
                  </p>
                  <p className="whitespace-pre-line text-sm">{data.description}</p>
                </CardContent>
              </Card>
            </li>
            {data.messages.map((message) => (
              <li key={message.id}>
                <Card
                  className={cn(message.from === 'SUPPORT' && 'border-primary/40 bg-primary/5')}
                >
                  <CardContent className="pt-4">
                    <p className="mb-1 text-xs text-muted-foreground">
                      {message.from === 'YOU' ? 'You' : `${message.name} · Vintrax Support`} ·{' '}
                      {dateTime(message.createdAt)}
                    </p>
                    <p className="whitespace-pre-line text-sm">{message.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
          <div className="mt-6 space-y-2">
            <Field
              label={
                data.status === 'RESOLVED' || data.status === 'CLOSED'
                  ? 'Still need help? Replying reopens the request.'
                  : 'Reply'
              }
              htmlFor="reply-body"
            >
              <Textarea
                id="reply-body"
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            <Button
              loading={reply.isPending}
              disabled={!body.trim()}
              onClick={() => reply.mutate(undefined)}
            >
              Send reply
            </Button>
            <ErrorAlert error={reply.error} />
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function SupportTicketPage() {
  return (
    <RequireAuth>
      <Ticket />
    </RequireAuth>
  );
}
