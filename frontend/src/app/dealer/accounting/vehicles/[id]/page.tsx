'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import { StatTile } from '@/components/stat-tile';
import {
  Amount,
  DataTable,
  PageHeader,
  Section,
  useAcctQuery,
  vehicleLabel,
} from '@/components/accounting/ui';
import { isoDate, money, percent, qs } from '@/lib/accounting';

interface VehicleRow {
  vehicleId: string;
  vin: string | null;
  stockNumber: string | null;
  year: number;
  make: string;
  model: string;
  purchaseCostCents: number;
  additionalCostsCents: number;
  reconditioningCents: number;
  totalCostCents: number;
  bookValueCents: number;
  acquiredOn: string | null;
  soldOn: string | null;
  daysInInventory: number | null;
  salePriceCents: number | null;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number | null;
  grossMarginBasisPoints: number | null;
  status: 'IN_STOCK' | 'SOLD';
  saleId: string | null;
  salesperson: { id: string; name: string } | null;
}

interface LedgerLine {
  lineId: string;
  date: string;
  journalEntryId: string;
  reference: string;
  description: string;
  account: { id: string; code: string; name: string };
  debitCents: number;
  creditCents: number;
}

/** One vehicle's whole financial story: what it cost, what it sold for, every ledger line tagged with it. */
export default function VehicleAccountingPage() {
  const { id } = useParams<{ id: string }>();
  const report = useAcctQuery<{ rows: VehicleRow[] }>(
    ['vehicle-profitability-all'],
    '/reports/vehicle-profitability',
  );
  const ledger = useAcctQuery<{ items: LedgerLine[] }>(
    ['vehicle-ledger', id],
    `/reports/general-ledger${qs({ vehicleId: id, preset: 'CUSTOM', from: '2000-01-01', to: '2100-12-31', pageSize: 500 })}`,
  );
  const row = report.data?.rows.find((entry) => entry.vehicleId === id);

  if (report.isPending && !report.data) return <Spinner />;
  if (report.error) return <ErrorAlert error={report.error} />;
  if (!row) {
    return (
      <>
        <PageHeader title="Vehicle" />
        <p className="text-sm text-muted-foreground">
          This vehicle has no accounting activity yet.{' '}
          <Link href="/dealer/accounting/purchases" className="text-primary hover:underline">
            Record its purchase
          </Link>
          .
        </p>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={vehicleLabel(row)}
        description={<span className="font-mono text-xs">{row.vin ?? 'No VIN'}</span>}
        actions={
          row.status === 'SOLD' ? (
            <Badge variant="success">Sold {isoDate(row.soldOn)}</Badge>
          ) : (
            <Badge variant="outline">In stock · {row.daysInInventory ?? 0} days</Badge>
          )
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Purchase"
          value={money(row.purchaseCostCents)}
          hint={row.acquiredOn ? `Acquired ${isoDate(row.acquiredOn)}` : undefined}
        />
        <StatTile
          label="Fees, transport and reconditioning"
          value={money(row.additionalCostsCents)}
          hint={`Reconditioning ${money(row.reconditioningCents)}`}
        />
        <StatTile
          label={row.status === 'SOLD' ? 'Cost of sale' : 'Book value'}
          value={money(row.status === 'SOLD' ? row.cogsCents : row.bookValueCents)}
        />
        <StatTile
          label="Gross profit"
          value={row.grossProfitCents === null ? '—' : money(row.grossProfitCents)}
          hint={
            row.status === 'SOLD'
              ? `Revenue ${money(row.revenueCents)} · margin ${percent(row.grossMarginBasisPoints)}`
              : 'Not sold yet'
          }
        />
      </div>
      {row.saleId ? (
        <Card className="mb-6">
          <CardContent className="pt-5 text-sm">
            <Link
              href={`/dealer/accounting/sales/${row.saleId}`}
              className="text-primary hover:underline"
            >
              Open the deal
            </Link>
            {row.salesperson ? (
              <span className="text-muted-foreground"> · sold by {row.salesperson.name}</span>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <Section title="Ledger lines for this vehicle">
        <DataTable
          dense
          loading={ledger.isPending}
          error={ledger.error}
          rows={ledger.data?.items}
          rowKey={(line) => line.lineId}
          columns={[
            { key: 'date', label: 'Date', render: (line) => isoDate(line.date) },
            {
              key: 'entry',
              label: 'Entry',
              render: (line) => (
                <Link
                  href={`/dealer/accounting/journal/${line.journalEntryId}`}
                  className="text-primary hover:underline"
                >
                  {line.reference}
                </Link>
              ),
            },
            {
              key: 'account',
              label: 'Account',
              render: (line) => `${line.account.code} ${line.account.name}`,
            },
            { key: 'description', label: 'Description', render: (line) => line.description },
            {
              key: 'debit',
              label: 'Debit',
              align: 'right',
              render: (line) => (line.debitCents ? <Amount cents={line.debitCents} /> : null),
            },
            {
              key: 'credit',
              label: 'Credit',
              align: 'right',
              render: (line) => (line.creditCents ? <Amount cents={line.creditCents} /> : null),
            },
          ]}
        />
      </Section>
    </>
  );
}
