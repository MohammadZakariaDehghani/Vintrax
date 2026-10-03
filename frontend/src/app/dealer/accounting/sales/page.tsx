'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Select } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { Amount, Can, DataTable, PageHeader, RangeFilter, StatusBadge, useAcctQuery, vehicleLabel } from '@/components/accounting/ui';
import { DEFAULT_RANGE, isoDate, qs, rangeParams, type Range, type RangeState } from '@/lib/accounting';

interface SaleRow {
  id: string;
  number: number;
  saleDate: string;
  status: string;
  vehicle: { id: string; vin: string | null; year: number; make: string; model: string; stockNumber: string | null };
  customer: { id: string; name: string };
  salesperson: string | null;
  salePriceCents: number;
  totalCents: number;
  taxCents: number;
  balanceDueCents: number;
  costOfSaleCents?: number;
}

export default function SalesPage() {
  const { can } = useAccounting();
  const [range, setRange] = useState<RangeState>({ ...DEFAULT_RANGE, preset: 'YEAR_TO_DATE' });
  const [status, setStatus] = useState('');
  const filters = { ...rangeParams(range), status };
  const { data, error, isPending } = useAcctQuery<{ range: Range; items: SaleRow[] }>(['sales', filters], `/sales${qs(filters)}`);
  const seesProfit = can('accounting.view');

  return (
    <>
      <PageHeader
        title="Deal desk"
        description="Work out a deal with taxes, trade-in, deposits and financing, save it as a draft, and post it when it is final."
        actions={
          <Can permission="accounting.sales">
            <Link href="/dealer/accounting/sales/new">
              <Button>
                <Plus className="h-4 w-4" aria-hidden /> New deal
              </Button>
            </Link>
          </Can>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <RangeFilter value={range} onChange={setRange} />
        <Select aria-label="Status" className="h-9 w-36" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All deals</option>
          <option value="DRAFT">Drafts</option>
          <option value="POSTED">Posted</option>
          <option value="VOID">Reversed</option>
        </Select>
      </div>
      <DataTable
        loading={isPending}
        error={error}
        rows={data?.items}
        rowKey={(row) => row.id}
        columns={[
          { key: 'number', label: 'Deal', render: (row) => <Link href={`/dealer/accounting/sales/${row.id}`} className="font-medium text-primary hover:underline">#{row.number}</Link> },
          { key: 'date', label: 'Date', render: (row) => isoDate(row.saleDate) },
          { key: 'vehicle', label: 'Vehicle', render: (row) => vehicleLabel(row.vehicle) },
          { key: 'customer', label: 'Customer', render: (row) => row.customer.name },
          { key: 'salesperson', label: 'Salesperson', render: (row) => row.salesperson ?? '—' },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status === 'VOID' ? 'REVERSED' : row.status} /> },
          { key: 'price', label: 'Price', align: 'right', render: (row) => <Amount cents={row.salePriceCents} /> },
          { key: 'tax', label: 'Tax', align: 'right', render: (row) => <Amount cents={row.taxCents} /> },
          { key: 'total', label: 'Total', align: 'right', render: (row) => <Amount cents={row.totalCents} strong /> },
          ...(seesProfit
            ? [{ key: 'cost', label: 'Cost of sale', align: 'right' as const, render: (row: SaleRow) => (row.status === 'POSTED' ? <Amount cents={row.costOfSaleCents} muted /> : '—') }]
            : []),
        ]}
      />
    </>
  );
}
