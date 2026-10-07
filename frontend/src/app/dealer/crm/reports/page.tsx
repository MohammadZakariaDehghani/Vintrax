'use client';

import { useState, type ReactNode } from 'react';
import { Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import { Bar, DataTable, PageHeader, RangePicker, Section, StatCard, rangeQuery, useCrmQuery, type RangeValue } from '@/components/crm/ui';
import { dollars, humanize, percent } from '@/lib/crm';

interface Reports {
  byStatus: Array<{ label: string; kind: string; count: number }>;
  bySource: Array<{ sourceId: string | null; label: string; leads: number; contacted: number; won: number; conversionRate: number | null; revenue: number; costCents: number | null; costPerLeadCents: number | null; costPerAcquisitionCents: number | null }>;
  bySalesperson: Array<{ userId: string | null; name: string; leads: number; contacted: number; won: number; conversionRate: number | null; averageResponseMinutes: number | null }>;
  byVehicle: Array<{ vehicleId: string; title: string; leads: number; won: number }>;
  funnel: { created: number; contacted: number; appointment: number; testDrive: number; won: number; appointmentConversion: number | null; testDriveConversion: number | null; salesConversion: number | null };
  lostReasons: Array<{ reason: string; count: number }>;
  responseTime: Record<string, number>;
  followUp: { tasksCompleted: number; tasksCompletedOnTime: number; missedFollowUps: number; contactedLeads: number; appointmentsBooked: number; appointmentsCompleted: number; noShows: number };
  email: { sent: number; deliveryRate: number | null; openRate: number | null; clickRate: number | null; replyRate: number | null; bounceRate: number | null; unsubscribeRate: number | null; conversionRate: number | null; deliveryReported: boolean };
  campaigns: Array<{ id: string; name: string; type: string; status: string; recipientCount: number; skippedCount: number; sent: number; opened: number; clicked: number; unsubscribed: number; costCents: number | null }>;
  automations: Array<{ automationId: string; name: string; enrolled: number; completed: number; stopped: number; failed: number; stoppedByReply: number; stoppedByWin: number }>;
  reengaged: number;
}

const BUCKETS: Array<[string, string]> = [
  ['under_5m', 'Under 5 minutes'],
  ['under_1h', 'Under an hour'],
  ['under_1d', 'Same day'],
  ['over_1d', 'Over a day'],
  ['not_contacted', 'Not contacted'],
];

function Bars({ rows }: { rows: Array<{ label: ReactNode; value: number; extra?: ReactNode }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No data in this period.</p> : null}
        {rows.map((row, index) => (
          <div key={index} className="text-sm">
            <div className="flex justify-between gap-2"><span>{row.label}</span><span className="tabular text-muted-foreground">{row.value}{row.extra ? <> · {row.extra}</> : null}</span></div>
            <Bar value={row.value} max={max} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function CrmReportsPage() {
  const [range, setRange] = useState<RangeValue>({ preset: 'THIS_MONTH', from: '', to: '' });
  const { data, error, isPending } = useCrmQuery<Reports>(['reports', range], `/reports${rangeQuery(range)}`);
  return (
    <>
      <PageHeader title="CRM reports" description="Lead volume, conversion, response time, follow-up, email, campaigns and automations for the period." />
      <div className="mb-6"><RangePicker value={range} onChange={setRange} /></div>
      <ErrorAlert error={error} />
      {isPending && !data ? <Spinner /> : null}
      {data ? (
        <>
          <Section title="Conversion">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <StatCard label="Leads" value={data.funnel.created} />
              <StatCard label="Contacted" value={data.funnel.contacted} />
              <StatCard label="Appointment" value={data.funnel.appointment} hint={`${percent(data.funnel.appointmentConversion)} of these won`} />
              <StatCard label="Test drive" value={data.funnel.testDrive} hint={`${percent(data.funnel.testDriveConversion)} of these won`} />
              <StatCard label="Won" value={data.funnel.won} hint={`${percent(data.funnel.salesConversion)} of leads`} tone="success" />
            </div>
          </Section>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Leads by status (now)"><Bars rows={data.byStatus.map((row) => ({ label: row.label, value: row.count }))} /></Section>
            <Section title="First response time"><Bars rows={BUCKETS.map(([key, label]) => ({ label, value: data.responseTime[key] ?? 0 }))} /></Section>
            <Section title="Lost reasons"><Bars rows={data.lostReasons.map((row) => ({ label: row.reason, value: row.count }))} /></Section>
            <Section title="Leads by vehicle"><Bars rows={data.byVehicle.map((row) => ({ label: row.title, value: row.leads, extra: `${row.won} won` }))} /></Section>
          </div>
          <Section title="Leads by source" description="Cost per lead and per sale use the monthly cost you set on each source.">
            <DataTable
              rows={data.bySource}
              rowKey={(row) => row.sourceId ?? 'none'}
              columns={[
                { key: 'source', label: 'Source', render: (row) => row.label },
                { key: 'leads', label: 'Leads', align: 'right', render: (row) => row.leads },
                { key: 'contacted', label: 'Contacted', align: 'right', render: (row) => row.contacted },
                { key: 'won', label: 'Won', align: 'right', render: (row) => row.won },
                { key: 'rate', label: 'Conversion', align: 'right', render: (row) => percent(row.conversionRate) },
                { key: 'revenue', label: 'Sales', align: 'right', render: (row) => dollars(row.revenue * 100) },
                { key: 'cpl', label: 'Cost / lead', align: 'right', render: (row) => dollars(row.costPerLeadCents) },
                { key: 'cpa', label: 'Cost / sale', align: 'right', render: (row) => dollars(row.costPerAcquisitionCents) },
              ]}
            />
          </Section>
          <Section title="Leads by salesperson">
            <DataTable
              rows={data.bySalesperson}
              rowKey={(row) => row.userId ?? 'none'}
              columns={[
                { key: 'name', label: 'Salesperson', render: (row) => row.name },
                { key: 'leads', label: 'Leads', align: 'right', render: (row) => row.leads },
                { key: 'contacted', label: 'Contacted', align: 'right', render: (row) => row.contacted },
                { key: 'won', label: 'Won', align: 'right', render: (row) => row.won },
                { key: 'rate', label: 'Conversion', align: 'right', render: (row) => percent(row.conversionRate) },
                { key: 'response', label: 'Avg. first response', align: 'right', render: (row) => (row.averageResponseMinutes === null ? '—' : `${row.averageResponseMinutes} min`) },
              ]}
            />
          </Section>
          <Section title="Follow-up and appointments">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Tasks completed" value={data.followUp.tasksCompleted} hint={`${data.followUp.tasksCompletedOnTime} on time`} />
              <StatCard label="Missed follow-ups" value={data.followUp.missedFollowUps} tone={data.followUp.missedFollowUps ? 'danger' : undefined} />
              <StatCard label="Appointments booked" value={data.followUp.appointmentsBooked} />
              <StatCard label="Completed / no-show" value={`${data.followUp.appointmentsCompleted} / ${data.followUp.noShows}`} />
              <StatCard label="Re-engaged leads" value={data.reengaged} hint="Quiet 30+ days, then replied" />
            </div>
          </Section>
          <Section title="Email performance" description={data.email.deliveryReported ? undefined : 'Delivery is reported only when an email provider webhook is connected; with SMTP alone, delivered = sent without a bounce.'}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Sent" value={data.email.sent} />
              <StatCard label="Delivery" value={percent(data.email.deliveryRate)} />
              <StatCard label="Open (approx.)" value={percent(data.email.openRate)} />
              <StatCard label="Click" value={percent(data.email.clickRate)} />
              <StatCard label="Reply" value={percent(data.email.replyRate)} />
              <StatCard label="Bounce" value={percent(data.email.bounceRate)} />
              <StatCard label="Unsubscribe" value={percent(data.email.unsubscribeRate)} />
              <StatCard label="Led to a sale" value={percent(data.email.conversionRate)} />
            </div>
          </Section>
          <Section title="Campaigns">
            <DataTable
              rows={data.campaigns}
              rowKey={(row) => row.id}
              columns={[
                { key: 'name', label: 'Campaign', render: (row) => row.name },
                { key: 'type', label: 'Type', render: (row) => humanize(row.type) },
                { key: 'sent', label: 'Sent', align: 'right', render: (row) => row.sent },
                { key: 'skipped', label: 'Skipped', align: 'right', render: (row) => row.skippedCount },
                { key: 'opened', label: 'Opened', align: 'right', render: (row) => row.opened },
                { key: 'clicked', label: 'Clicked', align: 'right', render: (row) => row.clicked },
                { key: 'unsub', label: 'Unsubscribed', align: 'right', render: (row) => row.unsubscribed },
                { key: 'cost', label: 'Cost', align: 'right', render: (row) => dollars(row.costCents) },
              ]}
            />
          </Section>
          <Section title="Automations">
            <DataTable
              rows={data.automations}
              rowKey={(row) => row.automationId}
              columns={[
                { key: 'name', label: 'Automation', render: (row) => row.name },
                { key: 'enrolled', label: 'Started', align: 'right', render: (row) => row.enrolled },
                { key: 'completed', label: 'Finished', align: 'right', render: (row) => row.completed },
                { key: 'reply', label: 'Stopped by reply', align: 'right', render: (row) => row.stoppedByReply },
                { key: 'won', label: 'Stopped by win', align: 'right', render: (row) => row.stoppedByWin },
                { key: 'stopped', label: 'Stopped', align: 'right', render: (row) => row.stopped },
                { key: 'failed', label: 'Failed', align: 'right', render: (row) => row.failed },
              ]}
            />
          </Section>
        </>
      ) : null}
    </>
  );
}
