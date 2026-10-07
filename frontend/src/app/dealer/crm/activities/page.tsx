'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CRM_ACTIVITY_LABELS, CRM_ACTIVITY_TYPES } from '@vintrax/shared';
import { Pagination, Select } from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import { DataTable, PageHeader, useCrmQuery } from '@/components/crm/ui';
import { dateTime, humanize, personName, qs, type Paged, type TimelineItem } from '@/lib/crm';

/** Calls, emails, notes, meetings and test drives across the caller's leads. */
export default function ActivitiesPage() {
  const { me, can } = useCrm();
  const [type, setType] = useState('');
  const [userId, setUserId] = useState('');
  const [people, setPeople] = useState(true);
  const [page, setPage] = useState(1);
  const query = qs({ type, userId, people: people ? 'true' : undefined, page, pageSize: 50 });
  const list = useCrmQuery<Paged<TimelineItem>>(['activities', query], `/activities${query}`);
  return (
    <>
      <PageHeader title="Activities" description="Everything logged against your leads, newest first." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Type" className="w-48" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
          <option value="">All types</option>
          {CRM_ACTIVITY_TYPES.map((value) => (
            <option key={value} value={value}>{CRM_ACTIVITY_LABELS[value]}</option>
          ))}
          <option value="EMAIL_SENT">Emails sent</option>
          <option value="STATUS_CHANGED">Status changes</option>
          <option value="CUSTOMER_REPLIED">Customer replies</option>
        </Select>
        {can('crm.all_leads') ? (
          <Select aria-label="Person" className="w-48" value={userId} onChange={(event) => { setUserId(event.target.value); setPage(1); }}>
            <option value="">Everyone</option>
            {me.staff.map((person) => (
              <option key={person.id} value={person.id}>{personName(person)}</option>
            ))}
          </Select>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={people} onChange={(event) => { setPeople(event.target.checked); setPage(1); }} /> Only what people logged
        </label>
      </div>
      <DataTable<TimelineItem>
        rows={list.data?.items}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          { key: 'when', label: 'When', render: (row) => dateTime(row.occurredAt) },
          { key: 'type', label: 'Type', render: (row) => CRM_ACTIVITY_LABELS[row.type as keyof typeof CRM_ACTIVITY_LABELS] ?? humanize(row.type) },
          {
            key: 'what',
            label: 'Activity',
            render: (row) => (
              <div>
                <span className="font-medium">{row.title}</span>
                {row.outcome ? <span className="block text-xs text-muted-foreground">Outcome: {row.outcome}</span> : null}
              </div>
            ),
          },
          {
            key: 'lead',
            label: 'Lead',
            render: (row) => (row.lead ? <Link href={`/dealer/crm/leads/${row.lead.id}`} className="hover:underline">{personName(row.lead)}</Link> : '—'),
          },
          { key: 'who', label: 'By', render: (row) => (row.user ? personName(row.user) : 'System') },
        ]}
      />
      <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onChange={setPage} />
    </>
  );
}
