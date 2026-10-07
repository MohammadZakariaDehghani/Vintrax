'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  CalendarPlus,
  CheckCircle2,
  Mail,
  MessageSquare,
  NotebookPen,
  Pencil,
  Phone,
  Trash2,
  UserCheck,
} from 'lucide-react';
import {
  CONSENT_TYPE_LABELS,
  CONSENT_TYPES,
  CRM_ACTIVITY_LABELS,
  type ConsentType,
} from '@vintrax/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import {
  ActivityDialog,
  AppointmentDialog,
  ComposeDialog,
  LeadDialog,
  TaskDialog,
} from '@/components/crm/forms';
import {
  CanCrm,
  Facts,
  LeadStatusBadge,
  StatusPill,
  TemperatureBadge,
  useCrmMutation,
  useCrmQuery,
} from '@/components/crm/ui';
import {
  crm,
  dateTime,
  dollars,
  humanize,
  personName,
  qs,
  shortDate,
  type AppointmentRow,
  type AutomationRow,
  type EmailRow,
  type LeadRow,
  type Paged,
  type TaskRow,
  type TimelineItem,
} from '@/lib/crm';

interface LeadDetail extends LeadRow {
  address: string | null;
  postalCode: string | null;
  vehicleUrl: string | null;
  tradeInVehicle: string | null;
  preferredAppointmentAt: string | null;
  notes: string | null;
  lostReason: string | null;
  team: string | null;
  assignedAt: string | null;
  convertedAt: string | null;
  conversationId: string | null;
  financeApplicationId: string | null;
  customer: { id: string; name: string; email: string | null; phone: string | null } | null;
  mergedFrom: Array<{ id: string; number: number; firstName: string; lastName: string | null }>;
  tasks: TaskRow[];
  appointments: AppointmentRow[];
  enrollments: Array<{
    id: string;
    status: string;
    currentStepId: string | null;
    nextRunAt: string | null;
    stopReason: string | null;
    lastError: string | null;
    startedAt: string;
    automation: { id: string; name: string };
  }>;
  consents: Array<{
    id: string;
    type: ConsentType;
    source: string;
    evidence: string | null;
    grantedAt: string;
    expiresAt: string | null;
    withdrawnAt: string | null;
  }>;
  suppressions: Array<{ reason: string; dealerId: string | null; createdAt: string }>;
  journey: Array<{ key: string; label: string; reachedAt: string | null }>;
  sales: Array<{
    id: string;
    number: number;
    status: string;
    saleDate: string;
    totalAmount: string;
    vehicle: { id: string; title: string };
  }>;
  deposits: Array<{ id: string; number: number; status: string; date: string; amount: string }>;
  emailCounts: Record<string, number>;
  marketingAllowed: boolean;
}

type Duplicate = LeadRow & { reasons: string[] };

const TIMELINE_FILTERS = [
  { id: '', label: 'Everything' },
  { id: 'CALL', label: 'Calls' },
  { id: 'EMAIL_SENT', label: 'Emails' },
  { id: 'NOTE', label: 'Notes' },
  { id: 'STATUS_CHANGED', label: 'Status' },
  { id: 'APPOINTMENT_BOOKED', label: 'Appointments' },
];

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { me, can } = useCrm();
  const lead = useCrmQuery<LeadDetail>(['lead', id], `/leads/${id}`);
  const [dialog, setDialog] = useState<
    | null
    | 'edit'
    | 'activity'
    | 'note'
    | 'task'
    | 'appointment'
    | 'email'
    | 'lost'
    | 'merge'
    | 'consent'
    | 'automation'
  >(null);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentRow | null>(null);

  const status = useCrmMutation((input: { statusId: string; lostReason?: string | null }) =>
    crm.post(`/leads/${id}/status`, input),
  );
  const assign = useCrmMutation((assignedToId: string | null) =>
    crm.post(`/leads/${id}/assign`, { assignedToId, team: null }),
  );
  const convert = useCrmMutation(() => crm.post(`/leads/${id}/convert`));
  const remove = useCrmMutation(
    () => crm.delete(`/leads/${id}`),
    () => router.push('/dealer/crm/leads'),
  );
  const completeTask = useCrmMutation((taskId: string) =>
    crm.post(`/tasks/${taskId}/status`, { status: 'COMPLETED' }),
  );
  const appointmentStatus = useCrmMutation((input: { id: string; status: string }) =>
    crm.post(`/appointments/${input.id}/status`, { status: input.status }),
  );
  const stopEnrollment = useCrmMutation((enrollmentId: string) =>
    crm.post(`/enrollments/${enrollmentId}/stop`),
  );
  const withdraw = useCrmMutation((consentId: string) =>
    crm.post(`/consents/${consentId}/withdraw`),
  );

  if (lead.error) return <ErrorAlert error={lead.error} />;
  if (!lead.data) return <Spinner />;
  const data = lead.data;
  const lostStatus = me.statuses.find((entry) => entry.kind === 'LOST');
  const mutationError =
    status.error ??
    assign.error ??
    convert.error ??
    remove.error ??
    completeTask.error ??
    appointmentStatus.error ??
    stopEnrollment.error ??
    withdraw.error;

  return (
    <>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            <Link href="/dealer/crm/leads" className="hover:underline">
              Leads
            </Link>{' '}
            · #{data.number}
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{personName(data)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <LeadStatusBadge status={data.status} />
            <TemperatureBadge temperature={data.temperature} score={data.score} />
            {data.tags.map((tag) => (
              <Badge key={tag.id} variant="outline">
                {tag.name}
              </Badge>
            ))}
            {data.customer ? <Badge variant="success">Customer</Badge> : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.vehicle ? (
              <>
                Interested in <strong className="text-foreground">{data.vehicle.title}</strong>{' '}
                ·{' '}
              </>
            ) : null}
            Next follow-up:{' '}
            <span
              className={
                data.nextFollowUpAt && new Date(data.nextFollowUpAt) < new Date()
                  ? 'font-medium text-destructive'
                  : 'text-foreground'
              }
            >
              {dateTime(data.nextFollowUpAt)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.phone ? (
            <a
              href={`tel:${data.phone}`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-secondary"
            >
              <Phone className="h-4 w-4" aria-hidden /> Call
            </a>
          ) : null}
          {data.phone ? (
            <a
              href={`sms:${data.phone}`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-secondary"
            >
              <MessageSquare className="h-4 w-4" aria-hidden /> Text
            </a>
          ) : null}
          {data.email && can('crm.email') ? (
            <Button variant="outline" onClick={() => setDialog('email')}>
              <Mail className="h-4 w-4" aria-hidden /> Email
            </Button>
          ) : null}
          {can('crm.work') ? (
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </Button>
          ) : null}
        </div>
      </div>

      <ErrorAlert error={mutationError} className="mb-3" />

      {/* Quick actions */}
      {can('crm.work') ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <Select
            aria-label="Status"
            className="h-9 w-48"
            value={data.status.id}
            onChange={(event) => {
              const next = me.statuses.find((entry) => entry.id === event.target.value);
              if (next?.kind === 'LOST') setDialog('lost');
              else status.mutate({ statusId: event.target.value });
            }}
          >
            {me.statuses
              .filter((entry) => entry.isActive !== false || entry.id === data.status.id)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
          </Select>
          {can('crm.manage') ? (
            <Select
              aria-label="Salesperson"
              className="h-9 w-48"
              value={data.assignedTo?.id ?? ''}
              onChange={(event) => assign.mutate(event.target.value || null)}
            >
              <option value="">Unassigned</option>
              {me.staff
                .filter((person) => person.role !== 'ACCOUNTANT')
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {personName(person)}
                  </option>
                ))}
            </Select>
          ) : !data.assignedTo ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => assign.mutate(me.me.userId)}
              loading={assign.isPending}
            >
              <UserCheck className="h-4 w-4" aria-hidden /> Take this lead
            </Button>
          ) : (
            <span className="self-center text-sm text-muted-foreground">
              Salesperson: {personName(data.assignedTo)}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => setDialog('activity')}>
            <Phone className="h-4 w-4" aria-hidden /> Log call / activity
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('note')}>
            <NotebookPen className="h-4 w-4" aria-hidden /> Add note
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingTask(null);
              setDialog('task');
            }}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Task
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingAppointment(null);
              setDialog('appointment');
            }}
          >
            <CalendarPlus className="h-4 w-4" aria-hidden /> Appointment
          </Button>
          {!data.customer ? (
            <Button
              size="sm"
              variant="outline"
              loading={convert.isPending}
              onClick={() => convert.mutate(undefined)}
            >
              Make customer
            </Button>
          ) : null}
          <CanCrm permission="crm.manage">
            <Button size="sm" variant="outline" onClick={() => setDialog('merge')}>
              Duplicates &amp; merge
            </Button>
          </CanCrm>
        </div>
      ) : (
        <p className="mb-6 text-sm text-muted-foreground">
          Status: {data.status.label}. Your role can view this lead but not change it.
        </p>
      )}

      {/* Journey */}
      <Card className="mb-6">
        <CardContent className="relative overflow-x-auto pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Purchase journey
          </p>
          <ol className="flex min-w-max items-start gap-0">
            {data.journey.map((stage, index) => (
              <li key={stage.key} className="flex items-start">
                <div className="flex w-24 flex-col items-center text-center">
                  <span
                    className={`mb-1 h-3 w-3 rounded-full ${stage.reachedAt ? 'bg-primary' : 'border border-border bg-background'}`}
                    aria-hidden
                  />
                  <span
                    className={`text-xs ${stage.reachedAt ? 'font-medium' : 'text-muted-foreground'}`}
                  >
                    {stage.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {stage.reachedAt ? shortDate(stage.reachedAt) : ''}
                  </span>
                  <span className="sr-only">{stage.reachedAt ? 'reached' : 'not reached'}</span>
                </div>
                {index < data.journey.length - 1 ? (
                  <span className="mt-1.5 h-px w-4 bg-border" aria-hidden />
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-6">
          <InfoCard title="Contact information">
            <Facts
              items={[
                ['Email', data.email ?? '—'],
                ['Phone', data.phone ?? '—'],
                ['Prefers', humanize(data.preferredContact)],
                [
                  'Address',
                  [data.address, data.city, data.province, data.postalCode]
                    .filter(Boolean)
                    .join(', ') || '—',
                ],
              ]}
            />
          </InfoCard>
          <InfoCard title="Lead information">
            <Facts
              items={[
                ['Source', data.source?.label ?? '—'],
                ['Campaign', data.campaign ?? '—'],
                ['Created', dateTime(data.createdAt)],
                ['First contact', dateTime(data.firstContactAt)],
                ['Last contact', dateTime(data.lastContactAt)],
                ['Last reply', dateTime(data.lastRepliedAt)],
                ['Last activity', dateTime(data.lastActivityAt)],
                ['Salesperson', personName(data.assignedTo)],
                ...(data.lostReason
                  ? ([['Lost because', data.lostReason]] as Array<[string, string]>)
                  : []),
              ]}
            />
            {data.notes ? (
              <p className="mt-3 whitespace-pre-line rounded-md bg-secondary/40 p-2 text-sm">
                {data.notes}
              </p>
            ) : null}
          </InfoCard>
          <InfoCard title="Vehicle interest, trade-in and financing">
            <Facts
              items={[
                ['Vehicle', data.vehicle ? data.vehicle.title : '—'],
                ['Price', data.vehicle ? dollars(data.vehicle.priceCad * 100) : '—'],
                ['VIN', data.interestedVin ?? data.vehicle?.vin ?? '—'],
                ['Budget', dollars(data.budgetCents)],
                [
                  'Financing',
                  data.financingInterest
                    ? data.financeApplicationId
                      ? 'Applied on Vintrax'
                      : 'Interested'
                    : 'No',
                ],
                ['Trade-in', data.tradeInInterest ? (data.tradeInVehicle ?? 'Yes') : 'No'],
                ['Preferred appointment', dateTime(data.preferredAppointmentAt)],
              ]}
            />
            {data.financeApplicationId ? (
              <Link
                href={`/dealer/finance/${data.financeApplicationId}`}
                className="mt-2 inline-block text-sm text-primary hover:underline"
              >
                Open the finance application
              </Link>
            ) : null}
          </InfoCard>
          <InfoCard title="Deal / sale">
            {data.sales.length === 0 && data.deposits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deposit or sale yet.{' '}
                {data.customer
                  ? 'Record them in Accounting → Deal desk; they appear here and on the journey.'
                  : 'Make the lead a customer to start a deal.'}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.deposits.map((deposit) => (
                  <li key={deposit.id}>
                    Deposit #{deposit.number} · {shortDate(deposit.date)} · $
                    {Number(deposit.amount).toLocaleString('en-CA')} ·{' '}
                    <StatusPill status={deposit.status} />
                  </li>
                ))}
                {data.sales.map((sale) => (
                  <li key={sale.id}>
                    Sale #{sale.number} · {sale.vehicle.title} · {shortDate(sale.saleDate)} · $
                    {Number(sale.totalAmount).toLocaleString('en-CA')} ·{' '}
                    <StatusPill status={sale.status} />
                  </li>
                ))}
              </ul>
            )}
          </InfoCard>
          <InfoCard
            title="Email consent (CASL)"
            action={
              can('crm.work') ? (
                <Button size="sm" variant="outline" onClick={() => setDialog('consent')}>
                  Record consent
                </Button>
              ) : null
            }
          >
            <p className="mb-2 text-sm">
              Marketing email:{' '}
              {data.marketingAllowed ? (
                <Badge variant="success">Allowed</Badge>
              ) : (
                <Badge variant="outline">Not allowed</Badge>
              )}
            </p>
            {data.suppressions.length ? (
              <p className="mb-2 text-sm text-destructive">
                Suppressed: {data.suppressions.map((row) => humanize(row.reason)).join(', ')}
              </p>
            ) : null}
            <ul className="space-y-2 text-sm">
              {data.consents.length === 0 ? (
                <li className="text-muted-foreground">No consent on record.</li>
              ) : null}
              {data.consents.map((consent) => (
                <li key={consent.id} className="rounded-md border border-border p-2">
                  <span className="font-medium">{CONSENT_TYPE_LABELS[consent.type]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {consent.source} · {shortDate(consent.grantedAt)}
                    {consent.expiresAt ? ` · expires ${shortDate(consent.expiresAt)}` : ''}
                    {consent.withdrawnAt ? ` · withdrawn ${shortDate(consent.withdrawnAt)}` : ''}
                  </span>
                  {consent.evidence ? (
                    <span className="block text-xs">“{consent.evidence}”</span>
                  ) : null}
                  {!consent.withdrawnAt ? (
                    <button
                      type="button"
                      className="mt-1 text-xs text-destructive hover:underline"
                      onClick={() => withdraw.mutate(consent.id)}
                    >
                      Withdraw
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </InfoCard>
          <InfoCard
            title="Automation"
            action={
              can('crm.email') ? (
                <Button size="sm" variant="outline" onClick={() => setDialog('automation')}>
                  Start…
                </Button>
              ) : null
            }
          >
            <ul className="space-y-2 text-sm">
              {data.enrollments.length === 0 ? (
                <li className="text-muted-foreground">No automations have run for this lead.</li>
              ) : null}
              {data.enrollments.map((enrollment) => (
                <li
                  key={enrollment.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {enrollment.automation.name} <StatusPill status={enrollment.status} />
                    <span className="block text-xs text-muted-foreground">
                      Started {dateTime(enrollment.startedAt)}
                      {enrollment.nextRunAt &&
                      (enrollment.status === 'ACTIVE' || enrollment.status === 'WAITING')
                        ? ` · next step ${dateTime(enrollment.nextRunAt)}`
                        : ''}
                      {enrollment.stopReason ? ` · ${humanize(enrollment.stopReason)}` : ''}
                    </span>
                  </span>
                  {(enrollment.status === 'ACTIVE' || enrollment.status === 'WAITING') &&
                  can('crm.email') ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => stopEnrollment.mutate(enrollment.id)}
                    >
                      Stop
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </InfoCard>
          <CanCrm permission="crm.manage">
            <Button
              variant="outline"
              className="text-destructive"
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm('Delete this lead and its history? This cannot be undone.'))
                  remove.mutate(undefined);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Delete lead
            </Button>
          </CanCrm>
        </div>

        <div className="space-y-6">
          <InfoCard
            title="Tasks"
            action={
              can('crm.work') ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingTask(null);
                    setDialog('task');
                  }}
                >
                  Add
                </Button>
              ) : null
            }
          >
            <ul className="divide-y divide-border">
              {data.tasks.length === 0 ? (
                <li className="py-2 text-sm text-muted-foreground">No open tasks.</li>
              ) : null}
              {data.tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <button
                    type="button"
                    className="min-w-0 text-left hover:underline"
                    onClick={() => {
                      setEditingTask(task);
                      setDialog('task');
                    }}
                  >
                    <span className="font-medium">{task.title}</span>
                    <span
                      className={`block text-xs ${task.dueAt && new Date(task.dueAt) < new Date() ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      Due {dateTime(task.dueAt)} · {personName(task.assignedTo)} ·{' '}
                      {humanize(task.priority)}
                    </span>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Complete ${task.title}`}
                    onClick={() => completeTask.mutate(task.id)}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Done
                  </Button>
                </li>
              ))}
            </ul>
          </InfoCard>
          <InfoCard
            title="Appointments"
            action={
              can('crm.work') ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingAppointment(null);
                    setDialog('appointment');
                  }}
                >
                  Book
                </Button>
              ) : null
            }
          >
            <ul className="divide-y divide-border">
              {data.appointments.length === 0 ? (
                <li className="py-2 text-sm text-muted-foreground">None booked.</li>
              ) : null}
              {data.appointments.map((appointment) => (
                <li
                  key={appointment.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => {
                      setEditingAppointment(appointment);
                      setDialog('appointment');
                    }}
                  >
                    <span className="font-medium">{humanize(appointment.type)}</span>{' '}
                    <StatusPill status={appointment.status} />
                    <span className="block text-xs text-muted-foreground">
                      {dateTime(appointment.startsAt)} · {personName(appointment.salesperson)}
                      {appointment.vehicle ? ` · ${appointment.vehicle.title}` : ''}
                    </span>
                  </button>
                  {appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED' ? (
                    <div className="flex gap-1">
                      {appointment.status === 'SCHEDULED' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            appointmentStatus.mutate({ id: appointment.id, status: 'CONFIRMED' })
                          }
                        >
                          Confirm
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          appointmentStatus.mutate({ id: appointment.id, status: 'COMPLETED' })
                        }
                      >
                        Completed
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          appointmentStatus.mutate({ id: appointment.id, status: 'NO_SHOW' })
                        }
                      >
                        No-show
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </InfoCard>
          <LeadEmails leadId={id} />
          <Timeline leadId={id} />
        </div>
      </div>

      <LeadDialog
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
        initial={{
          id: data.id,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          preferredContact: data.preferredContact,
          address: data.address,
          city: data.city,
          province: data.province,
          postalCode: data.postalCode,
          sourceId: data.source?.id ?? null,
          campaign: data.campaign,
          vehicleId: data.vehicle?.id ?? null,
          interestedVin: data.interestedVin,
          vehicleUrl: data.vehicleUrl,
          budgetCents: data.budgetCents,
          financingInterest: data.financingInterest,
          tradeInInterest: data.tradeInInterest,
          tradeInVehicle: data.tradeInVehicle,
          preferredAppointmentAt: data.preferredAppointmentAt,
          notes: data.notes,
          statusId: data.status.id,
          assignedToId: data.assignedTo?.id ?? null,
          team: data.team,
          nextFollowUpAt: data.nextFollowUpAt,
          tags: data.tags.map((tag) => tag.name),
        }}
      />
      <ActivityDialog open={dialog === 'activity'} onClose={() => setDialog(null)} leadId={id} />
      <ActivityDialog
        open={dialog === 'note'}
        onClose={() => setDialog(null)}
        leadId={id}
        defaultType="NOTE"
      />
      <TaskDialog
        open={dialog === 'task'}
        onClose={() => setDialog(null)}
        task={editingTask}
        leadId={id}
      />
      <AppointmentDialog
        open={dialog === 'appointment'}
        onClose={() => setDialog(null)}
        appointment={editingAppointment}
        leadId={id}
      />
      <ComposeDialog
        open={dialog === 'email'}
        onClose={() => setDialog(null)}
        leadId={id}
        marketingAllowed={data.marketingAllowed}
      />
      <LostDialog
        open={dialog === 'lost'}
        onClose={() => setDialog(null)}
        onConfirm={(reason) =>
          lostStatus
            ? status.mutateAsync({ statusId: lostStatus.id, lostReason: reason })
            : Promise.resolve()
        }
      />
      <MergeDialog open={dialog === 'merge'} onClose={() => setDialog(null)} leadId={id} />
      <ConsentDialog open={dialog === 'consent'} onClose={() => setDialog(null)} leadId={id} />
      <StartAutomationDialog
        open={dialog === 'automation'}
        onClose={() => setDialog(null)}
        leadId={id}
      />
    </>
  );
}

function InfoCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function LeadEmails({ leadId }: { leadId: string }) {
  const emails = useCrmQuery<Paged<EmailRow>>(
    ['lead-emails', leadId],
    `/emails${qs({ leadId, pageSize: 10 })}`,
  );
  return (
    <InfoCard
      title="Emails"
      action={
        <Link
          href={`/dealer/crm/emails?leadId=${leadId}`}
          className="text-sm text-primary hover:underline"
        >
          All
        </Link>
      }
    >
      <ul className="divide-y divide-border text-sm">
        {emails.data?.items.length === 0 ? (
          <li className="py-2 text-muted-foreground">No emails yet.</li>
        ) : null}
        {emails.data?.items.map((email) => (
          <li key={email.id} className="py-2">
            <span className="font-medium">{email.subject}</span>{' '}
            <StatusPill status={email.status} />
            <span className="block text-xs text-muted-foreground">
              {email.sentAt
                ? `Sent ${dateTime(email.sentAt)}`
                : `For ${dateTime(email.scheduledAt)}`}
              {email.openedAt ? ' · opened' : ''}
              {email.clickedAt ? ' · clicked' : ''}
              {email.repliedAt ? ' · replied' : ''}
              {email.enrollmentId ? ' · automated' : ''}
              {email.lastError && email.status !== 'SENT' ? ` · ${email.lastError}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </InfoCard>
  );
}

function Timeline({ leadId }: { leadId: string }) {
  const { dealerId } = useCrm();
  const [type, setType] = useState('');
  const timeline = useInfiniteQuery({
    queryKey: ['crm', dealerId, 'timeline', leadId, type],
    queryFn: ({ pageParam }) =>
      crm.get<{ items: TimelineItem[]; nextCursor: string | null }>(
        `/leads/${leadId}/timeline${qs({ type, cursor: pageParam, limit: 30 })}`,
      ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = timeline.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <InfoCard
      title="Timeline"
      action={
        <Select
          aria-label="Show"
          className="h-8 w-36 text-xs"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          {TIMELINE_FILTERS.map((filter) => (
            <option key={filter.id} value={filter.id}>
              {filter.label}
            </option>
          ))}
        </Select>
      }
    >
      <ErrorAlert error={timeline.error} />
      <ol className="relative space-y-4 border-l border-border pl-4">
        {items.map((item) => (
          <li key={item.id} className="relative">
            <span
              className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${item.isSystem ? 'bg-muted-foreground/50' : 'bg-primary'}`}
              aria-hidden
            />
            <p className="text-xs text-muted-foreground">
              {dateTime(item.occurredAt)} ·{' '}
              {CRM_ACTIVITY_LABELS[item.type as keyof typeof CRM_ACTIVITY_LABELS] ??
                humanize(item.type)}
              {item.user ? ` · ${personName(item.user)}` : ''}
            </p>
            <p className="text-sm font-medium">{item.title}</p>
            {item.outcome ? <p className="text-sm">Outcome: {item.outcome}</p> : null}
            {item.nextAction ? <p className="text-sm">Next: {item.nextAction}</p> : null}
            {item.notes ? (
              <p className="whitespace-pre-line text-sm text-muted-foreground">{item.notes}</p>
            ) : null}
          </li>
        ))}
        {items.length === 0 && !timeline.isPending ? (
          <li className="text-sm text-muted-foreground">Nothing yet.</li>
        ) : null}
      </ol>
      {timeline.hasNextPage ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          loading={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          Older
        </Button>
      ) : null}
    </InfoCard>
  );
}

function LostDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mark as lost"
      size="sm"
      footer={
        <Button
          variant="destructive"
          disabled={!reason.trim()}
          onClick={() =>
            onConfirm(reason.trim())
              .then(() => {
                setReason('');
                onClose();
              })
              .catch(setError)
          }
        >
          Mark lost
        </Button>
      }
    >
      <Field
        label="Why was it lost?"
        htmlFor="lost-reason"
        hint="Shown in the lost-reasons report."
      >
        <Input
          id="lost-reason"
          list="lost-reasons"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <datalist id="lost-reasons">
        {[
          'Bought elsewhere',
          'Price',
          'Financing declined',
          'Not ready to buy',
          'No response',
          'Vehicle sold',
          'Trade-in value',
        ].map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <ErrorAlert error={error} className="mt-2" />
    </Dialog>
  );
}

function MergeDialog({
  open,
  onClose,
  leadId,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
}) {
  const duplicates = useCrmQuery<Duplicate[]>(
    ['duplicates', leadId],
    `/leads/${leadId}/duplicates`,
    open,
  );
  const merge = useCrmMutation((duplicateId: string) =>
    crm.post(`/leads/${leadId}/merge`, { duplicateId }),
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Possible duplicates"
      description="Merging moves the other lead’s full history into this one and hides it."
      size="lg"
    >
      <ErrorAlert error={duplicates.error ?? merge.error} />
      {duplicates.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No likely duplicates found.</p>
      ) : null}
      <ul className="divide-y divide-border">
        {duplicates.data?.map((duplicate) => (
          <li
            key={duplicate.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <span>
              <Link
                href={`/dealer/crm/leads/${duplicate.id}`}
                className="font-medium hover:underline"
              >
                #{duplicate.number} {personName(duplicate)}
              </Link>
              <span className="block text-xs text-muted-foreground">
                Same {duplicate.reasons.map((reason) => reason.toLowerCase()).join(', ')} ·{' '}
                {duplicate.email ?? duplicate.phone ?? ''} · {duplicate.status.label}
              </span>
            </span>
            <Button
              size="sm"
              variant="outline"
              loading={merge.isPending && merge.variables === duplicate.id}
              onClick={() => {
                if (window.confirm(`Merge lead #${duplicate.number} into this one?`))
                  merge.mutate(duplicate.id);
              }}
            >
              Merge into this lead
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ConsentDialog({
  open,
  onClose,
  leadId,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
}) {
  const [form, setForm] = useState({ type: 'EXPRESS' as ConsentType, source: '', evidence: '' });
  const save = useCrmMutation(
    () => crm.post('/consents', { leadId, ...form, evidence: form.evidence || null }),
    () => onClose(),
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record consent"
      description="Only what the customer actually gave. The record keeps the source, wording and time (CASL)."
      footer={
        <Button
          disabled={!form.source.trim()}
          loading={save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          Save
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Kind" htmlFor="cd-type">
          <Select
            id="cd-type"
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value as ConsentType })}
          >
            {CONSENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONSENT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Where" htmlFor="cd-source">
          <Input
            id="cd-source"
            placeholder="Phone call on Oct 5, website form…"
            value={form.source}
            onChange={(event) => setForm({ ...form, source: event.target.value })}
          />
        </Field>
        <Field label="What they agreed to" htmlFor="cd-evidence">
          <Textarea
            id="cd-evidence"
            rows={2}
            value={form.evidence}
            onChange={(event) => setForm({ ...form, evidence: event.target.value })}
          />
        </Field>
        <ErrorAlert error={save.error} />
      </div>
    </Dialog>
  );
}

function StartAutomationDialog({
  open,
  onClose,
  leadId,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
}) {
  const automations = useCrmQuery<AutomationRow[]>(['automations'], '/automations', open);
  const [automationId, setAutomationId] = useState('');
  const start = useCrmMutation(
    () => crm.post(`/automations/${automationId}/enroll`, { leadId }),
    () => onClose(),
  );
  const active = (automations.data ?? []).filter((automation) => automation.isActive);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start an automation"
      footer={
        <Button
          disabled={!automationId}
          loading={start.isPending}
          onClick={() => start.mutate(undefined)}
        >
          Start
        </Button>
      }
    >
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No automation is switched on. Turn one on under CRM → Automations.
        </p>
      ) : null}
      <Select
        aria-label="Automation"
        value={automationId}
        onChange={(event) => setAutomationId(event.target.value)}
      >
        <option value="">Choose</option>
        {active.map((automation) => (
          <option key={automation.id} value={automation.id}>
            {automation.name}
          </option>
        ))}
      </Select>
      <ErrorAlert error={start.error} className="mt-2" />
    </Dialog>
  );
}
