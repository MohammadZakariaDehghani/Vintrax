'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import { LeadDialog } from '@/components/crm/forms';
import {
  Bar,
  PageHeader,
  RangePicker,
  Section,
  StatCard,
  rangeQuery,
  useCrmQuery,
  type RangeValue,
} from '@/components/crm/ui';
import { dateTime, dollars, percent, personName, time } from '@/lib/crm';

interface Dashboard {
  responseTargetMinutes: number;
  counts: {
    newLeads: number;
    previousNewLeads: number;
    uncontacted: number;
    followUpToday: number;
    overdueFollowUps: number;
    hot: number;
    warm: number;
    cold: number;
    appointmentsToday: number;
    openTasks: number;
    overdueTasks: number;
    activeOpportunities: number;
    won: number;
    lost: number;
    conversionRate: number | null;
    averageResponseMinutes: number | null;
    contactedWithinTarget: number | null;
  };
  todaysTasks: Array<{ id: string; title: string; dueAt: string; lead: { id: string; firstName: string; lastName: string | null; phone: string | null } | null }>;
  overdueTasks: Array<{ id: string; title: string; dueAt: string; lead: { id: string; firstName: string; lastName: string | null } | null }>;
  upcomingAppointments: Array<{ id: string; type: string; startsAt: string; lead: { id: string; firstName: string; lastName: string | null }; vehicle: { title: string } | null }>;
  hotLeads: Array<{ id: string; number: number; firstName: string; lastName: string | null; score: number; phone: string | null; vehicle: { title: string } | null }>;
  sources: Array<{ sourceId: string | null; label: string; leads: number; won: number; conversionRate: number | null; costPerLeadCents: number | null; revenue: number }>;
  email: { sent: number; openRate: number | null; clickRate: number | null; replyRate: number | null; bounceRate: number | null; unsubscribeRate: number | null; opensApproximate: boolean };
  followUp: { tasksCompleted: number; tasksCompletedOnTime: number; missedFollowUps: number; contactedLeads: number; appointmentsBooked: number; appointmentsCompleted: number; noShows: number };
}

function minutes(value: number | null) {
  if (value === null) return '—';
  if (value < 60) return `${value} min`;
  if (value < 1440) return `${Math.round(value / 60)} h`;
  return `${Math.round(value / 1440)} d`;
}

export default function CrmOverviewPage() {
  const [range, setRange] = useState<RangeValue>({ preset: 'THIS_MONTH', from: '', to: '' });
  const [adding, setAdding] = useState(false);
  const { data, error, isPending } = useCrmQuery<Dashboard>(['dashboard', range], `/dashboard${rangeQuery(range)}`);

  return (
    <>
      <PageHeader
        title="CRM overview"
        description="Who needs you today, how fast your team responds, and where your leads come from."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New lead
          </Button>
        }
      />
      <div className="mb-6">
        <RangePicker value={range} onChange={setRange} />
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      {isPending && !data ? <Spinner /> : null}
      {data ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="New leads" value={data.counts.newLeads} hint={`${data.counts.previousNewLeads} the period before`} href="/dealer/crm/leads?view=NEW" />
            <StatCard label="Not contacted yet" value={data.counts.uncontacted} tone={data.counts.uncontacted ? 'warning' : undefined} href="/dealer/crm/leads?view=UNCONTACTED" />
            <StatCard label="Follow up today" value={data.counts.followUpToday} href="/dealer/crm/leads?view=FOLLOW_UP_TODAY" />
            <StatCard label="Overdue follow-ups" value={data.counts.overdueFollowUps} tone={data.counts.overdueFollowUps ? 'danger' : undefined} href="/dealer/crm/leads?view=OVERDUE" />
            <StatCard label="Hot / warm / cold" value={`${data.counts.hot} / ${data.counts.warm} / ${data.counts.cold}`} tone="hot" href="/dealer/crm/leads?view=HOT" />
            <StatCard label="Appointments today" value={data.counts.appointmentsToday} href="/dealer/crm/calendar" />
            <StatCard label="Open tasks" value={data.counts.openTasks} hint={`${data.counts.overdueTasks} overdue`} tone={data.counts.overdueTasks ? 'danger' : undefined} href="/dealer/crm/tasks" />
            <StatCard label="Active opportunities" value={data.counts.activeOpportunities} href="/dealer/crm/pipeline" />
            <StatCard label="Won" value={data.counts.won} tone="success" href="/dealer/crm/leads?view=WON" />
            <StatCard label="Lost" value={data.counts.lost} href="/dealer/crm/leads?view=LOST" />
            <StatCard label="Conversion" value={percent(data.counts.conversionRate)} hint="New leads in the period now won" />
            <StatCard
              label="Average first response"
              value={minutes(data.counts.averageResponseMinutes)}
              hint={`${percent(data.counts.contactedWithinTarget)} within ${data.responseTargetMinutes} min`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Today’s tasks">
              <List
                empty="Nothing due today."
                items={data.todaysTasks.map((task) => ({
                  key: task.id,
                  title: task.title,
                  meta: `${time(task.dueAt)}${task.lead?.phone ? ` · ${task.lead.phone}` : ''}`,
                  href: task.lead ? `/dealer/crm/leads/${task.lead.id}` : '/dealer/crm/tasks',
                }))}
              />
            </Section>
            <Section title="Overdue tasks">
              <List
                empty="No overdue tasks."
                tone="danger"
                items={data.overdueTasks.map((task) => ({
                  key: task.id,
                  title: task.title,
                  meta: `Due ${dateTime(task.dueAt)}`,
                  href: task.lead ? `/dealer/crm/leads/${task.lead.id}` : '/dealer/crm/tasks',
                }))}
              />
            </Section>
            <Section title="Upcoming appointments">
              <List
                empty="No appointments booked."
                items={data.upcomingAppointments.map((appointment) => ({
                  key: appointment.id,
                  title: `${appointment.type.replace(/_/g, ' ').toLowerCase()} · ${personName(appointment.lead)}`,
                  meta: `${dateTime(appointment.startsAt)}${appointment.vehicle ? ` · ${appointment.vehicle.title}` : ''}`,
                  href: `/dealer/crm/leads/${appointment.lead.id}`,
                }))}
              />
            </Section>
            <Section title="Hot leads">
              <List
                empty="No hot leads right now."
                items={data.hotLeads.map((lead) => ({
                  key: lead.id,
                  title: `#${lead.number} ${personName(lead)} · score ${lead.score}`,
                  meta: [lead.vehicle?.title, lead.phone].filter(Boolean).join(' · '),
                  href: `/dealer/crm/leads/${lead.id}`,
                }))}
              />
            </Section>
          </div>

          <Section title="Lead source performance">
            <Card>
              <CardContent className="space-y-3 pt-4">
                {data.sources.length === 0 ? <p className="text-sm text-muted-foreground">No leads in this period.</p> : null}
                {data.sources.map((source) => (
                  <div key={source.sourceId ?? 'none'} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium">{source.label}</span>
                    <span className="tabular text-muted-foreground">
                      {source.leads} leads · {source.won} won · {percent(source.conversionRate)}
                      {source.costPerLeadCents !== null ? ` · ${dollars(source.costPerLeadCents)}/lead` : ''}
                      {source.revenue ? ` · ${dollars(source.revenue * 100)} sales` : ''}
                    </span>
                    <div className="col-span-2">
                      <Bar value={source.leads} max={Math.max(...data.sources.map((row) => row.leads))} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Email performance" description={data.email.opensApproximate ? 'Opens are approximate: mail apps that block or pre-load images skew them.' : undefined}>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Sent" value={data.email.sent} />
                <StatCard label="Opened" value={percent(data.email.openRate)} />
                <StatCard label="Clicked" value={percent(data.email.clickRate)} />
                <StatCard label="Replied" value={percent(data.email.replyRate)} />
                <StatCard label="Bounced" value={percent(data.email.bounceRate)} />
                <StatCard label="Unsubscribed" value={percent(data.email.unsubscribeRate)} />
              </div>
            </Section>
            <Section title="Follow-up performance">
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Contacted" value={data.followUp.contactedLeads} />
                <StatCard label="Tasks done" value={data.followUp.tasksCompleted} hint={`${data.followUp.tasksCompletedOnTime} on time`} />
                <StatCard label="Missed" value={data.followUp.missedFollowUps} tone={data.followUp.missedFollowUps ? 'danger' : undefined} />
                <StatCard label="Booked" value={data.followUp.appointmentsBooked} />
                <StatCard label="Completed" value={data.followUp.appointmentsCompleted} />
                <StatCard label="No-shows" value={data.followUp.noShows} />
              </div>
            </Section>
          </div>
        </>
      ) : null}
      <LeadDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function List({
  items,
  empty,
  tone,
}: {
  items: Array<{ key: string; title: string; meta: string; href: string }>;
  empty: string;
  tone?: 'danger';
}) {
  return (
    <Card>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="block px-4 py-2.5 hover:bg-secondary/40">
                <span className={`block text-sm font-medium ${tone === 'danger' ? 'text-destructive' : ''}`}>{item.title}</span>
                <span className="block text-xs text-muted-foreground">{item.meta}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
