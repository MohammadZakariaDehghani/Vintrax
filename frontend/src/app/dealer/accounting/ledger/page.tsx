'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { JOURNAL_SOURCES, JOURNAL_SOURCE_LABELS, type JournalSource } from '@vintrax/shared';
import { Input, Pagination, Select } from '@/components/ui';
import {
  AccountOptions,
  Amount,
  DataTable,
  ExportButtons,
  PageHeader,
  RangeFilter,
  RangeLabel,
  useAccounts,
  useAcctQuery,
  vehicleLabel,
} from '@/components/accounting/ui';
import { DEFAULT_RANGE, isoDate, qs, rangeParams, sourceHref, type Range, type RangeState } from '@/lib/accounting';

interface LedgerLine {
  lineId: string;
  date: string;
  journalEntryId: string;
  reference: string;
  description: string;
  source: JournalSource;
  sourceType: string | null;
  sourceId: string | null;
  account: { id: string; code: string; name: string };
  vehicle: { id: string; vin: string | null; year: number; make: string; model: string } | null;
  customer: { id: string; name: string } | null;
  vendor: { id: string; name: string } | null;
  debitCents: number;
  creditCents: number;
  balanceCents: number | null;
}

interface Ledger {
  range: Range;
  account: { id: string; code: string; name: string } | null;
  openingCents: number;
  debitsCents: number;
  creditsCents: number;
  closingCents: number;
  items: LedgerLine[];
  page: number;
  totalPages: number;
  total: number;
}

function GeneralLedger() {
  const params = useSearchParams();
  const accounts = useAccounts();
  const systemKey = params?.get('account');
  const fromKey = systemKey ? accounts.data?.find((account) => account.systemKey === systemKey)?.id : undefined;
  const [accountId, setAccountId] = useState(params?.get('accountId') ?? '');
  const effectiveAccount = accountId || fromKey || '';
  const [range, setRange] = useState<RangeState>({ ...DEFAULT_RANGE, preset: 'CURRENT_FISCAL_YEAR' });
  const [source, setSource] = useState('');
  const [vin, setVin] = useState('');
  const [reference, setReference] = useState('');
  const [page, setPage] = useState(1);
  const vehicleId = params?.get('vehicleId') ?? '';
  const customerId = params?.get('customerId') ?? '';
  const vendorId = params?.get('vendorId') ?? '';

  const filters = { ...rangeParams(range), accountId: effectiveAccount, source, vin, reference, vehicleId, customerId, vendorId };
  const { data, error, isPending } = useAcctQuery<Ledger>(['ledger', filters, page], `/reports/general-ledger${qs({ ...filters, page, pageSize: 100 })}`, !systemKey || Boolean(accounts.data));
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="General ledger"
        description="Every posted line, with its journal entry and source document. Choose one account for a running balance."
        actions={<ExportButtons report="general-ledger" params={filters} />}
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <RangeFilter value={range} onChange={(next) => { setRange(next); reset(); }} />
        <Select aria-label="Account" className="h-9 w-64" value={effectiveAccount} onChange={(event) => { setAccountId(event.target.value); reset(); }}>
          <option value="">All accounts</option>
          <AccountOptions accounts={accounts.data} filter={() => true} />
        </Select>
        <Select aria-label="Source" className="h-9 w-44" value={source} onChange={(event) => { setSource(event.target.value); reset(); }}>
          <option value="">All sources</option>
          {JOURNAL_SOURCES.map((entry) => (
            <option key={entry} value={entry}>{JOURNAL_SOURCE_LABELS[entry]}</option>
          ))}
        </Select>
        <Input aria-label="VIN" placeholder="VIN" className="h-9 w-44" value={vin} onChange={(event) => { setVin(event.target.value.toUpperCase()); reset(); }} />
        <Input aria-label="Reference" placeholder="Reference" className="h-9 w-36" value={reference} onChange={(event) => { setReference(event.target.value); reset(); }} />
      </div>
      {vehicleId || customerId || vendorId ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Filtered to one {vehicleId ? 'vehicle' : customerId ? 'customer' : 'vendor'}.{' '}
          <Link href="/dealer/accounting/ledger" className="text-primary hover:underline">Clear</Link>
        </p>
      ) : null}
      {data ? (
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <RangeLabel range={data.range} />
          {data.account ? <span>Opening <Amount cents={data.openingCents} strong /></span> : null}
          <span>Debits <Amount cents={data.debitsCents} /></span>
          <span>Credits <Amount cents={data.creditsCents} /></span>
          {data.account ? <span>Closing <Amount cents={data.closingCents} strong /></span> : null}
          <span className="text-muted-foreground">{data.total} lines</span>
        </div>
      ) : null}
      <DataTable
        dense
        loading={isPending}
        error={error}
        rows={data?.items}
        rowKey={(row) => row.lineId}
        columns={[
          { key: 'date', label: 'Date', render: (row) => <span className="whitespace-nowrap">{isoDate(row.date)}</span> },
          { key: 'ref', label: 'Entry', render: (row) => <Link href={`/dealer/accounting/journal/${row.journalEntryId}`} className="whitespace-nowrap text-primary hover:underline">{row.reference}</Link> },
          { key: 'account', label: 'Account', render: (row) => <button type="button" className="text-left hover:text-primary" onClick={() => { setAccountId(row.account.id); reset(); }}>{row.account.code} {row.account.name}</button> },
          {
            key: 'description',
            label: 'Description',
            render: (row) => {
              const href = sourceHref(row.sourceType, row.sourceId);
              const detail = [row.vehicle ? vehicleLabel(row.vehicle) : null, row.customer?.name, row.vendor?.name].filter(Boolean).join(' · ');
              return (
                <>
                  {href ? <Link href={href} className="hover:text-primary">{row.description}</Link> : row.description}
                  {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
                </>
              );
            },
          },
          { key: 'debit', label: 'Debit', align: 'right', render: (row) => (row.debitCents ? <Amount cents={row.debitCents} /> : null) },
          { key: 'credit', label: 'Credit', align: 'right', render: (row) => (row.creditCents ? <Amount cents={row.creditCents} /> : null) },
          ...(data?.account ? [{ key: 'balance', label: 'Balance', align: 'right' as const, render: (row: LedgerLine) => <Amount cents={row.balanceCents} strong /> }] : []),
        ]}
      />
      {data ? <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} /> : null}
    </>
  );
}

export default function GeneralLedgerPage() {
  return (
    <Suspense>
      <GeneralLedger />
    </Suspense>
  );
}
