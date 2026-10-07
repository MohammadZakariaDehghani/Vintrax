'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Lock, MessageSquare } from 'lucide-react';
import { ADMIN_TASK_TYPES, CRM_PRIORITIES, TICKET_STATUSES } from '@vintrax/shared';
import { Badge, Button, Card, CardContent, ErrorAlert, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { Facts, StatusPill, useCrmMutation, useSupportQuery } from '@/components/crm/ui';
import { dateTime, fromLocalInput, humanize, personName, support, toLocalInput, type Person, type SupportSettingsView, type TicketRow } from '@/lib/crm';

interface TicketDetail extends TicketRow {
  description: string;
  resolution: string | null;
  closedAt: string | null;
  reopenedCount: number;
  waitingSince: string | null;
  firstResponseDueAt: string | null;
  messages: Array<{ id: string; authorRole: string; visibility: 'PUBLIC' | 'INTERNAL'; body: string; createdAt: string; author: Person | null }>;
  events: Array<{ id: string; type: string; fromValue: string | null; toValue: string | null; detail: string | null; createdAt: string }>;
  tasks: Array<{ id: string; title: string; status: string; dueAt: string | null; assignedTo: Person | null }>;
  emails: Array<{ id: string; subject: string; status: string; sentAt: string | null; createdAt: string; toEmail: string; lastError: string | null }>;
  enrollments: Array<{ id: string; status: string; stopReason: string | null; startedAt: string; automation: { id: string; name: string } }>;
}

/**
 * One ticket. Public replies (emailed to the requester and shown in their
 * portal) and internal notes (admins only, never sent) are written in
 * separate boxes and drawn differently, so one is never mistaken for the other.
 */
export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const ticket = useSupportQuery<TicketDetail>(support, ['ticket', id], `/tickets/${id}`, true, 30_000);
  const settings = useSupportQuery<SupportSettingsView>(support, ['settings'], '/settings');
  const [reply, setReply] = useState('');
  const [replyStatus, setReplyStatus] = useState('');
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [task, setTask] = useState({ title: '', type: 'OTHER', dueAt: '' });
  useEffect(() => {
    if (ticket.data) setResolution(ticket.data.resolution ?? '');
  }, [ticket.data]);

  const update = useCrmMutation((patch: Record<string, unknown>) => support.put(`/tickets/${id}`, patch), undefined, 'support');
  const send = useCrmMutation(
    (input: { body: string; visibility: 'PUBLIC' | 'INTERNAL'; status?: string }) => support.post(`/tickets/${id}/messages`, input),
    undefined,
    'support',
  );
  const addTask = useCrmMutation(
    () =>
      support.post('/tasks', {
        type: task.type,
        title: task.title,
        ticketId: id,
        dealerId: ticket.data?.dealer?.id ?? null,
        subjectUserId: ticket.data?.requester?.id ?? null,
        dueAt: fromLocalInput(task.dueAt),
        priority: 'MEDIUM',
        status: 'OPEN',
        assignedToId: ticket.data?.assignedTo?.id ?? null,
      }),
    () => setTask({ title: '', type: 'OTHER', dueAt: '' }),
    'support',
  );

  if (ticket.error) return <ErrorAlert error={ticket.error} />;
  if (!ticket.data) return <Spinner />;
  const t = ticket.data;
  const timeline = [
    ...t.messages.map((message) => ({ kind: 'message' as const, at: message.createdAt, message })),
    ...t.events.filter((event) => !['REPLIED', 'INTERNAL_NOTE', 'REQUESTER_REPLIED'].includes(event.type)).map((event) => ({ kind: 'event' as const, at: event.createdAt, event })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const nameOf = (userId: string | null) => {
    const admin = settings.data?.admins.find((entry) => entry.id === userId);
    return admin ? personName(admin) : userId ? 'an admin' : '—';
  };

  return (
    <>
      <p className="mb-1 text-sm text-muted-foreground"><Link href="/admin/crm/tickets" className="hover:underline">Tickets</Link> · #{t.number}</p>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.subject}</h1>
          <div className="mt-2 flex flex-wrap gap-2"><StatusPill status={t.status} /><StatusPill status={t.priority} />{t.category ? <Badge variant="outline">{t.category.label}</Badge> : null}{t.tags.map((tag) => <Badge key={tag.id} variant="outline">{tag.name}</Badge>)}</div>
        </div>
      </div>
      <ErrorAlert error={update.error ?? send.error ?? addTask.error} className="mb-3" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <h2 className="mb-3 text-base font-semibold">Conversation and history</h2>
              <ol className="space-y-3">
                {timeline.map((entry) =>
                  entry.kind === 'message' ? (
                    <li
                      key={entry.message.id}
                      className={`rounded-md border p-3 text-sm ${entry.message.visibility === 'INTERNAL' ? 'border-warning/60 bg-warning/10' : entry.message.authorRole === 'REQUESTER' ? 'border-border bg-card' : 'border-primary/40 bg-primary/5'}`}
                    >
                      <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                        {entry.message.visibility === 'INTERNAL' ? <Lock className="h-3 w-3" aria-hidden /> : <MessageSquare className="h-3 w-3" aria-hidden />}
                        {entry.message.visibility === 'INTERNAL' ? 'Internal note' : entry.message.authorRole === 'REQUESTER' ? 'Requester' : 'Reply to requester'}
                        {entry.message.author ? ` · ${personName(entry.message.author)}` : ''} · {dateTime(entry.message.createdAt)}
                      </p>
                      <p className="whitespace-pre-line">{entry.message.body}</p>
                    </li>
                  ) : (
                    <li key={entry.event.id} className="text-xs text-muted-foreground">
                      {dateTime(entry.event.createdAt)} · {humanize(entry.event.type)}
                      {entry.event.type === 'ASSIGNED' ? ` to ${nameOf(entry.event.toValue)}` : entry.event.toValue && entry.event.type.includes('STATUS') ? ` → ${humanize(entry.event.toValue)}` : ''}
                      {entry.event.detail ? ` · ${entry.event.detail}` : ''}
                    </li>
                  ),
                )}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-4">
              <Field label={`Reply to ${t.requesterName ?? t.requesterEmail} (emailed and shown in their portal)`} htmlFor="tk-reply">
                <Textarea id="tk-reply" rows={4} value={reply} onChange={(event) => setReply(event.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Then set status" className="h-9 w-56" value={replyStatus} onChange={(event) => setReplyStatus(event.target.value)}>
                  <option value="">Then: waiting for the user</option>
                  {TICKET_STATUSES.map((status) => <option key={status} value={status}>Then: {humanize(status)}</option>)}
                </Select>
                <Button disabled={!reply.trim()} loading={send.isPending && send.variables?.visibility === 'PUBLIC'} onClick={() => send.mutate({ body: reply, visibility: 'PUBLIC', status: replyStatus || undefined }, { onSuccess: () => setReply('') })}>
                  Send reply
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="border-warning/60">
            <CardContent className="space-y-2 pt-4">
              <Field label="Internal note (admins only; never sent or shown to the user or dealer)" htmlFor="tk-note">
                <Textarea id="tk-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>
              <Button variant="outline" disabled={!note.trim()} loading={send.isPending && send.variables?.visibility === 'INTERNAL'} onClick={() => send.mutate({ body: note, visibility: 'INTERNAL' }, { onSuccess: () => setNote('') })}>
                <Lock className="h-4 w-4" aria-hidden /> Add internal note
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 pt-4">
              <Field label="Status" htmlFor="tk-status">
                <Select id="tk-status" value={t.status} onChange={(event) => update.mutate({ status: event.target.value })}>
                  {TICKET_STATUSES.map((status) => <option key={status} value={status}>{humanize(status)}</option>)}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="tk-priority">
                <Select id="tk-priority" value={t.priority} onChange={(event) => update.mutate({ priority: event.target.value })}>
                  {CRM_PRIORITIES.map((priority) => <option key={priority} value={priority}>{humanize(priority)}</option>)}
                </Select>
              </Field>
              <Field label="Assigned to" htmlFor="tk-assignee">
                <Select id="tk-assignee" value={t.assignedTo?.id ?? ''} onChange={(event) => update.mutate({ assignedToId: event.target.value || null })}>
                  <option value="">Unassigned</option>
                  {settings.data?.admins.map((admin) => <option key={admin.id} value={admin.id}>{personName(admin)}</option>)}
                </Select>
              </Field>
              <Field label="Team" htmlFor="tk-team">
                <Select id="tk-team" value={t.team?.id ?? ''} onChange={(event) => update.mutate({ teamId: event.target.value || null })}>
                  <option value="">—</option>
                  {settings.data?.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </Select>
              </Field>
              <Field label="Category" htmlFor="tk-category">
                <Select id="tk-category" value={t.category?.id ?? ''} onChange={(event) => update.mutate({ categoryId: event.target.value || null })}>
                  <option value="">—</option>
                  {settings.data?.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                </Select>
              </Field>
              <Field label="Due" htmlFor="tk-due">
                <Input id="tk-due" type="datetime-local" defaultValue={toLocalInput(t.dueAt)} onBlur={(event) => update.mutate({ dueAt: fromLocalInput(event.target.value) ?? '' })} />
              </Field>
              <Field label="Tags (comma separated)" htmlFor="tk-tags">
                <Input id="tk-tags" defaultValue={t.tags.map((tag) => tag.name).join(', ')} onBlur={(event) => update.mutate({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
              </Field>
              <Field label="Resolution" htmlFor="tk-resolution">
                <Textarea id="tk-resolution" rows={2} value={resolution} onChange={(event) => setResolution(event.target.value)} onBlur={() => resolution !== (t.resolution ?? '') && update.mutate({ resolution })} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <h2 className="mb-2 text-base font-semibold">Requester</h2>
              <Facts
                items={[
                  ['Name', t.requesterName ?? '—'],
                  ['Email', t.requesterEmail],
                  ['Account', t.requester ? <Link key="u" href={`/admin/crm/users/${t.requester.id}`} className="text-primary hover:underline">User 360</Link> : 'No account'],
                  ['Dealer', t.dealer ? <Link key="d" href={`/admin/crm/dealers/${t.dealer.id}`} className="text-primary hover:underline">{t.dealer.name}</Link> : '—'],
                  ['Source', humanize(t.source)],
                  ['Created', dateTime(t.createdAt)],
                  ['First response', t.firstResponseAt ? dateTime(t.firstResponseAt) : `due ${dateTime(t.firstResponseDueAt)}`],
                  ['Reopened', String(t.reopenedCount)],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 pt-4">
              <h2 className="text-base font-semibold">Tasks</h2>
              <ul className="text-sm">
                {t.tasks.length === 0 ? <li className="text-muted-foreground">None.</li> : null}
                {t.tasks.map((entry) => <li key={entry.id}>{entry.title} · <StatusPill status={entry.status} /> · {dateTime(entry.dueAt)}</li>)}
              </ul>
              <div className="grid gap-2">
                <Input aria-label="New task" placeholder="New task" value={task.title} onChange={(event) => setTask({ ...task, title: event.target.value })} />
                <div className="flex gap-2">
                  <Select aria-label="Task type" value={task.type} onChange={(event) => setTask({ ...task, type: event.target.value })}>
                    {ADMIN_TASK_TYPES.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
                  </Select>
                  <Input aria-label="Due" type="datetime-local" value={task.dueAt} onChange={(event) => setTask({ ...task, dueAt: event.target.value })} />
                </div>
                <Button size="sm" variant="outline" disabled={!task.title.trim()} loading={addTask.isPending} onClick={() => addTask.mutate(undefined)}>Add task</Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <h2 className="mb-2 text-base font-semibold">Emails</h2>
              <ul className="space-y-1 text-sm">
                {t.emails.length === 0 ? <li className="text-muted-foreground">None.</li> : null}
                {t.emails.map((email) => (
                  <li key={email.id}>{email.subject} · <StatusPill status={email.status} /> <span className="text-xs text-muted-foreground">{dateTime(email.sentAt ?? email.createdAt)}{email.lastError && email.status !== 'SENT' ? ` · ${email.lastError}` : ''}</span></li>
                ))}
              </ul>
              <h2 className="mb-2 mt-4 text-base font-semibold">Automations</h2>
              <ul className="space-y-1 text-sm">
                {t.enrollments.length === 0 ? <li className="text-muted-foreground">None.</li> : null}
                {t.enrollments.map((enrollment) => (
                  <li key={enrollment.id}>{enrollment.automation.name} · <StatusPill status={enrollment.status} />{enrollment.stopReason ? <span className="text-xs text-muted-foreground"> · {humanize(enrollment.stopReason)}</span> : null}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
