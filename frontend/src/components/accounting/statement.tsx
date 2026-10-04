'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui';
import { Amount, DataTable, PageHeader, useAcctQuery } from './ui';
import { isoDate, qs, todayIso } from '@/lib/accounting';

interface StatementLine {
  date: string;
  reference: string;
  description: string;
  journalEntryId: string;
  chargesCents?: number;
  paymentsCents?: number;
  billedCents?: number;
  paidCents?: number;
  balanceCents: number;
}

interface Statement {
  customer?: { name: string; email: string | null };
  vendor?: { name: string; email: string | null };
  openingCents: number;
  closingCents: number;
  lines: StatementLine[];
}

/** A customer or vendor statement: opening balance, every movement, closing balance. */
export function PartyStatement({ kind, id }: { kind: 'customers' | 'vendors'; id: string }) {
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const { data, error, isPending } = useAcctQuery<Statement>(
    ['statement', kind, id, from, to],
    `/${kind}/${id}/statement${qs({ from, to })}`,
  );
  const party = data?.customer ?? data?.vendor;
  const customer = kind === 'customers';
  return (
    <>
      <PageHeader
        title={party ? party.name : 'Statement'}
        description={
          customer
            ? 'Customer statement — what they owe, from the receivables ledger.'
            : 'Vendor statement — what you owe, from the payables ledger.'
        }
        actions={
          <Link
            href={`/dealer/accounting/ledger?${customer ? 'customerId' : 'vendorId'}=${id}`}
            className="text-sm text-primary hover:underline"
          >
            All ledger lines
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <Input
            type="date"
            className="h-9 w-40"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <Input
            type="date"
            className="h-9 w-40"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>
      {data ? (
        <p className="mb-3 text-sm">
          Opening balance <Amount cents={data.openingCents} strong /> · Closing balance{' '}
          <Amount cents={data.closingCents} strong />
        </p>
      ) : null}
      <DataTable
        loading={isPending}
        error={error}
        rows={data?.lines}
        rowKey={(row, index) => `${row.journalEntryId}-${index}`}
        columns={[
          { key: 'date', label: 'Date', render: (row) => isoDate(row.date) },
          {
            key: 'ref',
            label: 'Reference',
            render: (row) => (
              <Link
                href={`/dealer/accounting/journal/${row.journalEntryId}`}
                className="text-primary hover:underline"
              >
                {row.reference}
              </Link>
            ),
          },
          { key: 'description', label: 'Description', render: (row) => row.description },
          {
            key: 'in',
            label: customer ? 'Charges' : 'Billed',
            align: 'right',
            render: (row) => (
              <Amount cents={(customer ? row.chargesCents : row.billedCents) || null} />
            ),
          },
          {
            key: 'out',
            label: customer ? 'Payments' : 'Paid',
            align: 'right',
            render: (row) => (
              <Amount cents={(customer ? row.paymentsCents : row.paidCents) || null} />
            ),
          },
          {
            key: 'balance',
            label: 'Balance',
            align: 'right',
            render: (row) => <Amount cents={row.balanceCents} strong />,
          },
        ]}
      />
    </>
  );
}
