'use client';

import { useState, type ReactNode } from 'react';
import { Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import {
  Bar,
  PageHeader,
  RangePicker,
  Section,
  StatCard,
  rangeQuery,
  useSupportQuery,
  type RangeValue,
} from '@/components/crm/ui';
import { humanize, support } from '@/lib/crm';

interface SupportReports {
  created: number;
  resolved: number;
  openNow: number;
  overdueNow: number;
  reopened: number;
  averageResolutionHours: number | null;
  averageFirstResponseHours: number | null;
  userIssues: number;
  dealerIssues: number;
  featureRequests: number;
  byCategory: Array<{ label: string; count: number }>;
  byPriority: Array<{ label: string; count: number }>;
  bySource: Array<{ label: string; count: number }>;
  byDealer: Array<{ label: string; id: string | null; count: number }>;
  byAdmin: Array<{ label: string; count: number }>;
  communication: {
    emails: number;
    publicReplies: number;
    requesterMessages: number;
    internalNotes: number;
  };
}

function hours(value: number | null): string {
  if (value === null) return '—';
  return value < 1 ? `${Math.round(value * 60)} min` : `${value.toFixed(1)} h`;
}

function Bars({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: ReactNode; count: number }>;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets in this period.</p>
        ) : null}
        {rows.map((row, index) => (
          <div key={index} className="text-sm">
            <div className="flex justify-between gap-2">
              <span>{row.label}</span>
              <span className="tabular text-muted-foreground">{row.count}</span>
            </div>
            <Bar value={row.count} max={max} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AdminCrmReportsPage() {
  const [range, setRange] = useState<RangeValue>({ preset: 'THIS_MONTH', from: '', to: '' });
  const { data, error, isPending } = useSupportQuery<SupportReports>(
    support,
    ['reports', range],
    `/reports${rangeQuery(range)}`,
  );
  return (
    <>
      <PageHeader
        title="Support reports"
        description="Ticket volume, response and resolution times, and where issues come from. Times are in Toronto time."
      />
      <div className="mb-6">
        <RangePicker value={range} onChange={setRange} />
      </div>
      <ErrorAlert error={error} />
      {isPending && !data ? <Spinner /> : null}
      {data ? (
        <>
          <Section title="Tickets">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Created" value={data.created} />
              <StatCard label="Resolved" value={data.resolved} />
              <StatCard label="Open now" value={data.openNow} />
              <StatCard
                label="Overdue now"
                value={data.overdueNow}
                tone={data.overdueNow ? 'warning' : undefined}
              />
              <StatCard
                label="Average first response"
                value={hours(data.averageFirstResponseHours)}
              />
              <StatCard label="Average resolution" value={hours(data.averageResolutionHours)} />
              <StatCard label="Reopened" value={data.reopened} />
              <StatCard label="Feature requests" value={data.featureRequests} />
              <StatCard label="User issues" value={data.userIssues} />
              <StatCard label="Dealer issues" value={data.dealerIssues} />
            </div>
          </Section>
          <Section title="Breakdown" className="mt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Bars title="By category" rows={data.byCategory} />
              <Bars
                title="By priority"
                rows={data.byPriority.map((row) => ({ ...row, label: humanize(row.label) }))}
              />
              <Bars
                title="By source"
                rows={data.bySource.map((row) => ({ ...row, label: humanize(row.label) }))}
              />
              <Bars title="By admin" rows={data.byAdmin} />
              <Bars title="Dealers with the most tickets" rows={data.byDealer} />
            </div>
          </Section>
          <Section title="Communication" className="mt-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Emails sent" value={data.communication.emails} />
              <StatCard label="Public replies" value={data.communication.publicReplies} />
              <StatCard label="Requester messages" value={data.communication.requesterMessages} />
              <StatCard label="Internal notes" value={data.communication.internalNotes} />
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}
