'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Plus } from 'lucide-react';
import { JOURNAL_SOURCES, JOURNAL_SOURCE_LABELS, type JournalSource } from '@vintrax/shared';
import { Button, Input, Pagination, Select } from '@/components/ui';
import { Amount, Can, DataTable, EntryStatus, ExportButtons, PageHeader, RangeFilter, useAcctQuery } from '@/components/accounting/ui';
import { JournalEntryDialog, newJournalDraft } from '@/components/accounting/journal-form';
import { DEFAULT_RANGE, isoDate, qs, rangeParams, type Paged, type Range, type RangeState } from '@/lib/accounting';

interface EntryRow {
  id: string;
  number: number;
  reference: string;
  date: string;
  description: string;
  source: JournalSource;
  kind: string;
  status: 'DRAFT' | 'POSTED';
  totalCents: number;
  reversed: boolean;
  reversalOfId: string | null;
}


function JournalList() {
  const params = useSearchParams();
  const [range, setRange] = useState<RangeState>({ ...DEFAULT_RANGE, preset: 'CURRENT_FISCAL_YEAR' });
  const [source, setSource] = useState('');
  const [status, setStatus] = useState(params?.get('status') ?? '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [draft] = useState(newJournalDraft);

  const filters = { ...rangeParams(range), source, status, q, page, pageSize: 50 };
  const { data, error, isPending } = useAcctQuery<Paged<EntryRow> & { range: Range }>(['journal', filters], `/journal${qs(filters)}`);

  return (
    <>
      <PageHeader
        title="Journal entries"
        description="Every posting, automatic or manual. Posted entries cannot be edited or deleted; correct them with a reversal."
        actions={
          <Can permission="accounting.create">
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New entry
            </Button>
          </Can>
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <RangeFilter value={range} onChange={(next) => { setRange(next); setPage(1); }} />
          <Select aria-label="Source" className="h-9 w-48" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}>
            <option value="">All sources</option>
            {JOURNAL_SOURCES.map((entry) => (
              <option key={entry} value={entry}>{JOURNAL_SOURCE_LABELS[entry]}</option>
            ))}
          </Select>
          <Select aria-label="Status" className="h-9 w-32" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">Any status</option>
            <option value="POSTED">Posted</option>
            <option value="DRAFT">Draft</option>
          </Select>
          <Input type="search" aria-label="Search entries" placeholder="Reference or description" className="h-9 w-56" value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} />
        </div>
        <ExportButtons report="journal-entries" params={{ ...rangeParams(range), source, status, q }} />
      </div>
      <DataTable
        loading={isPending}
        error={error}
        rows={data?.items}
        rowKey={(row) => row.id}
        columns={[
          { key: 'ref', label: 'Reference', render: (row) => <Link href={`/dealer/accounting/journal/${row.id}`} className="font-medium text-primary hover:underline">{row.reference}</Link> },
          { key: 'date', label: 'Date', render: (row) => <span className="whitespace-nowrap">{isoDate(row.date)}</span> },
          { key: 'description', label: 'Description', render: (row) => row.description },
          { key: 'source', label: 'Source', render: (row) => <span className="whitespace-nowrap text-muted-foreground">{JOURNAL_SOURCE_LABELS[row.source]}</span> },
          { key: 'status', label: 'Status', render: (row) => <EntryStatus status={row.status} reversed={row.reversed} /> },
          { key: 'amount', label: 'Amount', align: 'right', render: (row) => <Amount cents={row.totalCents} /> },
        ]}
      />
      {data ? <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} /> : null}
      <JournalEntryDialog open={creating} initial={draft} onClose={() => setCreating(false)} />
    </>
  );
}

export default function JournalPage() {
  return (
    <Suspense>
      <JournalList />
    </Suspense>
  );
}
