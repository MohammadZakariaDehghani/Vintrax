'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@vintrax/shared';
import { Badge, Button, Input } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { PaymentDialog } from '@/components/accounting/payment-dialog';
import { Amount, Can, DataTable, PageHeader, RangeFilter, ReasonDialog, StatusBadge, useAcctQuery } from '@/components/accounting/ui';
import { DEFAULT_RANGE, acct, isoDate, qs, rangeParams, type RangeState } from '@/lib/accounting';

interface Payment {
  id: string;
  number: number;
  direction: 'RECEIVED' | 'SENT';
  kind: string;
  customer: { id: string; name: string } | null;
  vendor: { id: string; name: string } | null;
  date: string;
  amountCents: number;
  method: PaymentMethod;
  reference: string | null;
  bankAccount: { id: string; name: string };
  status: string;
  allocations: Array<{ invoice: { id: string; number: string } | null; bill: { id: string; number: number; vendorReference: string | null } | null; amountCents: number }>;
  unallocatedCents: number;
  journalEntryId: string | null;
}

function Payments() {
  const params = useSearchParams();
  const focus = params?.get('payment');
  const { can } = useAccounting();
  const [range, setRange] = useState<RangeState>({ ...DEFAULT_RANGE, preset: 'CURRENT_FISCAL_YEAR' });
  const [reference, setReference] = useState(params?.get('reference') ?? '');
  const [recording, setRecording] = useState<'RECEIVED' | 'SENT' | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const filters = { ...rangeParams(range), reference };
  const list = useAcctQuery<{ items: Payment[] }>(['payments', filters], `/payments${qs(filters)}`);
  const rows = (list.data?.items ?? []).filter((row) => !focus || row.id === focus);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received from customers and paid to vendors, and what each payment settled."
        actions={
          <Can permission="accounting.post">
            <Button variant="outline" onClick={() => setRecording('SENT')}>Pay a vendor</Button>
            <Button onClick={() => setRecording('RECEIVED')}>Receive a payment</Button>
          </Can>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <RangeFilter value={range} onChange={setRange} />
        <Input type="search" aria-label="Reference" placeholder="Reference" className="h-9 w-48" value={reference} onChange={(event) => setReference(event.target.value)} />
        {focus ? <Link href="/dealer/accounting/payments" className="self-center text-sm text-primary hover:underline">Show all</Link> : null}
      </div>
      <DataTable
        loading={list.isPending}
        error={list.error}
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: 'number', label: 'No.', render: (row) => `#${row.number}` },
          { key: 'date', label: 'Date', render: (row) => isoDate(row.date) },
          { key: 'direction', label: '', render: (row) => <Badge variant={row.direction === 'RECEIVED' ? 'success' : 'outline'}>{row.direction === 'RECEIVED' ? 'In' : 'Out'}{row.kind === 'REFUND' ? ' · refund' : ''}</Badge> },
          { key: 'party', label: 'With', render: (row) => row.customer?.name ?? row.vendor?.name ?? '—' },
          { key: 'method', label: 'Method', render: (row) => `${PAYMENT_METHOD_LABELS[row.method]}${row.reference ? ` · ${row.reference}` : ''}` },
          { key: 'bank', label: 'Account', render: (row) => row.bankAccount.name },
          {
            key: 'applied',
            label: 'Applied to',
            render: (row) =>
              [
                ...row.allocations.map((allocation) => (allocation.invoice ? allocation.invoice.number : allocation.bill ? `Bill #${allocation.bill.number}` : '')),
                ...(row.unallocatedCents > 0 ? ['on account'] : []),
              ].join(', ') || '—',
          },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          { key: 'amount', label: 'Amount', align: 'right', render: (row) => <Amount cents={row.direction === 'RECEIVED' ? row.amountCents : -row.amountCents} strong /> },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) => (
              <span className="flex justify-end gap-1">
                {row.journalEntryId ? <Link href={`/dealer/accounting/journal/${row.journalEntryId}`}><Button size="sm" variant="ghost">Entry</Button></Link> : null}
                {row.status === 'POSTED' && can('accounting.reverse') ? <Button size="sm" variant="ghost" onClick={() => setReversing(row)}>Reverse</Button> : null}
              </span>
            ),
          },
        ]}
      />
      {recording ? <PaymentDialog direction={recording} onClose={() => setRecording(null)} /> : null}
      <ReasonDialog
        open={Boolean(reversing)}
        title={`Reverse payment #${reversing?.number ?? ''}`}
        description="Reopens what it settled. A payment already cleared in a bank reconciliation cannot be reversed."
        confirmLabel="Reverse payment"
        onClose={() => setReversing(null)}
        onConfirm={(reason) => acct.post(`/payments/${reversing!.id}/reverse`, { reason })}
      />
    </>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense>
      <Payments />
    </Suspense>
  );
}
