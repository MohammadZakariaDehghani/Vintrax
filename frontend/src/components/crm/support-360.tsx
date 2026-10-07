'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button, Card, CardContent, ErrorAlert, Field, Input, Textarea } from '@/components/ui';
import { dateTime, humanize, personName, support, type Person } from '@/lib/crm';
import { StatusPill, useCrmMutation } from './ui';

export function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="pt-4">
        <h2 className="mb-2 text-base font-semibold">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

export function TicketList({ tickets }: { tickets: Array<{ id: string; number: number; subject: string; status: string; priority: string; createdAt: string }> }) {
  if (!tickets.length) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {tickets.map((ticket) => (
        <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <Link href={`/admin/crm/tickets/${ticket.id}`} className="hover:underline">#{ticket.number} {ticket.subject}</Link>
          <span className="flex gap-1"><StatusPill status={ticket.priority} /><StatusPill status={ticket.status} /></span>
        </li>
      ))}
    </ul>
  );
}

export function TaskList({ tasks }: { tasks: Array<{ id: string; title: string; status: string; dueAt: string | null; assignedTo: Person | null }> }) {
  if (!tasks.length) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {tasks.map((task) => (
        <li key={task.id}>{task.title} · <StatusPill status={task.status} /> <span className="text-xs text-muted-foreground">{dateTime(task.dueAt)} · {personName(task.assignedTo)}</span></li>
      ))}
    </ul>
  );
}

export function ActivityList({ items }: { items: Array<{ id: string; action: string; entityType: string; actorEmail: string | null; createdAt: string }> }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing recorded.</p>;
  return (
    <ul className="space-y-0.5 text-xs">
      {items.map((item) => (
        <li key={item.id}><span className="text-muted-foreground">{dateTime(item.createdAt)}</span> · {item.action.replace(/[._]/g, ' ')} · {humanize(item.entityType)} · {item.actorEmail ?? 'system'}</li>
      ))}
    </ul>
  );
}

/** Message a user or a dealer (its owner) by email and/or in the app, from a 360 page. */
export function MessageBox({ userId, dealerId }: { userId?: string; dealerId?: string }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [channels, setChannels] = useState<string[]>(['EMAIL', 'IN_APP']);
  const send = useCrmMutation(
    () => support.post('/messages', { userId: userId ?? null, dealerId: dealerId ?? null, subject, body, channels }),
    () => {
      setSubject('');
      setBody('');
    },
    'support',
  );
  return (
    <div className="space-y-2">
      <Field label="Subject" htmlFor="mb-subject"><Input id="mb-subject" value={subject} onChange={(event) => setSubject(event.target.value)} /></Field>
      <Field label="Message" htmlFor="mb-body"><Textarea id="mb-body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {['EMAIL', 'IN_APP'].map((channel) => (
          <label key={channel} className="flex items-center gap-1">
            <input type="checkbox" checked={channels.includes(channel)} onChange={(event) => setChannels(event.target.checked ? [...channels, channel] : channels.filter((value) => value !== channel))} />
            {channel === 'EMAIL' ? 'Email' : 'In-app notification'}
          </label>
        ))}
        <Button size="sm" disabled={!subject.trim() || !body.trim() || !channels.length} loading={send.isPending} onClick={() => send.mutate(undefined)}>Send</Button>
        {send.isSuccess ? <span className="text-success">Sent.</span> : null}
      </div>
      <ErrorAlert error={send.error} />
    </div>
  );
}
