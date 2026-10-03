'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Banknote,
  Car,
  FileText,
  HandCoins,
  Landmark,
  PiggyBank,
  Receipt,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react';
import { AGING_BUCKETS, AGING_BUCKET_LABELS, TAX_RETURN_KIND_LABELS, type TaxReturnKind } from '@vintrax/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorAlert, Spinner } from '@/components/ui';
import { StatTile } from '@/components/stat-tile';
import { Amount, PageHeader, RangeFilter, RangeLabel, useAcctQuery } from '@/components/accounting/ui';
import { DEFAULT_RANGE, isoDate, money, percent, qs, rangeParams, type Range, type RangeState } from '@/lib/accounting';

interface Dashboard {
  range: Range;
  cashCents: number;
  bankCents: number;
  accountsReceivableCents: number;
  accountsPayableCents: number;
  inventoryValueCents: number;
  vehiclesSold: number;
  salesRevenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMarginBasisPoints: number | null;
  operatingExpensesCents: number;
  netIncomeCents: number;
  taxBalances: Array<{ kind: TaxReturnKind; payableCents: number; recoverableCents: number; netCents: number }>;
  customerDepositsCents: number;
  floorPlanCents: number;
  inventoryAging: Record<'D0_30' | 'D31_60' | 'D61_90' | 'D91_PLUS', number>;
  inventoryAgingUnits: Record<'D0_30' | 'D31_60' | 'D61_90' | 'D91_PLUS', number>;
  inventoryUnits: number;
  arAging: Record<(typeof AGING_BUCKETS)[number], number>;
  apAging: Record<(typeof AGING_BUCKETS)[number], number>;
  upcomingBills: Array<{ id: string; number: number; vendor: { name: string }; dueDate: string; balanceCents: number; daysUntilDue: number }>;
  recurringExpensesDue: number;
}

const INVENTORY_BUCKETS = [
  ['D0_30', '0–30 days'],
  ['D31_60', '31–60 days'],
  ['D61_90', '61–90 days'],
  ['D91_PLUS', '90+ days'],
] as const;

export default function AccountingOverviewPage() {
  const [range, setRange] = useState<RangeState>(DEFAULT_RANGE);
  const { data, error, isPending } = useAcctQuery<Dashboard>(['dashboard', range], `/dashboard${qs(rangeParams(range))}`);

  return (
    <>
      <PageHeader
        title="Accounting overview"
        description="Every figure comes from posted journal entries — the same ledger your statements are built from."
        actions={<RangeFilter value={range} onChange={setRange} />}
      />
      {error ? <ErrorAlert error={error} /> : null}
      {isPending && !data ? <Spinner /> : null}
      {data ? (
        <>
          <div className="mb-2">
            <RangeLabel range={data.range} />
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Sales revenue" value={money(data.salesRevenueCents)} hint={`${data.vehiclesSold} vehicles sold`} icon={TrendingUp} href="/dealer/accounting/reports?report=profit-loss" />
            <StatTile label="Gross profit" value={money(data.grossProfitCents)} hint={`Margin ${percent(data.grossMarginBasisPoints)} · cost of sales ${money(data.cogsCents)}`} icon={PiggyBank} href="/dealer/accounting/reports?report=vehicle-profitability" />
            <StatTile label="Operating expenses" value={money(data.operatingExpensesCents)} icon={Receipt} href="/dealer/accounting/expenses" />
            <StatTile label="Net income" value={money(data.netIncomeCents)} icon={Banknote} href="/dealer/accounting/reports?report=profit-loss" />
            <StatTile label="Bank balances" value={money(data.bankCents)} hint={`Cash on hand ${money(data.cashCents)}`} icon={Landmark} href="/dealer/accounting/banking" />
            <StatTile label="Accounts receivable" value={money(data.accountsReceivableCents)} icon={FileText} href="/dealer/accounting/receivables" />
            <StatTile label="Accounts payable" value={money(data.accountsPayableCents)} icon={Wallet} href="/dealer/accounting/payables" />
            <StatTile label="Vehicle inventory" value={money(data.inventoryValueCents)} hint={`${data.inventoryUnits} units at book value`} icon={Car} href="/dealer/accounting/reports?report=inventory-valuation" />
            <StatTile label="Customer deposits held" value={money(data.customerDepositsCents)} hint="Owed to customers until the sale" icon={HandCoins} href="/dealer/accounting/deposits" />
            <StatTile label="Floor plan owing" value={money(data.floorPlanCents)} icon={Truck} href="/dealer/accounting/floor-plan" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sales tax balances</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 text-left">Return</th>
                      <th className="py-1 text-right">Collected</th>
                      <th className="py-1 text-right">Recoverable</th>
                      <th className="py-1 text-right">Net owing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.taxBalances
                      .filter((row) => row.payableCents !== 0 || row.recoverableCents !== 0 || row.kind === 'GST_HST')
                      .map((row) => (
                        <tr key={row.kind} className="border-t border-border">
                          <td className="py-1.5">{TAX_RETURN_KIND_LABELS[row.kind]}</td>
                          <td className="py-1.5 text-right"><Amount cents={row.payableCents} /></td>
                          <td className="py-1.5 text-right"><Amount cents={row.recoverableCents} /></td>
                          <td className="py-1.5 text-right"><Amount cents={row.netCents} strong /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <Link href="/dealer/accounting/tax" className="mt-3 inline-block text-sm text-primary hover:underline">
                  Open the Tax Center
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inventory aging</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars
                  rows={INVENTORY_BUCKETS.map(([key, label]) => ({
                    label,
                    value: data.inventoryAging[key],
                    note: `${data.inventoryAgingUnits[key]} units`,
                    tone: key === 'D91_PLUS' ? 'warning' : 'primary',
                  }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Receivables aging</CardTitle>
              </CardHeader>
              <CardContent>
                <Bars rows={AGING_BUCKETS.map((bucket) => ({ label: AGING_BUCKET_LABELS[bucket], value: data.arAging[bucket], tone: bucket === 'CURRENT' ? 'primary' : 'warning' }))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bills coming due</CardTitle>
              </CardHeader>
              <CardContent>
                {data.upcomingBills.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bills due in the next two weeks.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {data.upcomingBills.map((bill) => (
                      <li key={bill.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate">
                          {bill.vendor.name} <span className="text-muted-foreground">#{bill.number}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <Badge variant={bill.daysUntilDue <= 3 ? 'warning' : 'outline'}>{isoDate(bill.dueDate)}</Badge>
                          <Amount cents={bill.balanceCents} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.recurringExpensesDue > 0 ? (
                  <p className="mt-3 text-sm">
                    <Link href="/dealer/accounting/expenses" className="text-primary hover:underline">
                      {data.recurringExpensesDue} recurring expense{data.recurringExpensesDue === 1 ? ' is' : 's are'} due to post
                    </Link>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}

function Bars({ rows }: { rows: Array<{ label: string; value: number; note?: string; tone: 'primary' | 'warning' }> }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.label} className="text-sm">
          <div className="mb-0.5 flex justify-between gap-2">
            <span>
              {row.label}
              {row.note ? <span className="ml-2 text-xs text-muted-foreground">{row.note}</span> : null}
            </span>
            <Amount cents={row.value} />
          </div>
          <div className="h-2 rounded-full bg-secondary">
            <div
              className={`h-2 rounded-full ${row.tone === 'warning' ? 'bg-warning' : 'bg-primary'}`}
              style={{ width: `${Math.round((Math.abs(row.value) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
