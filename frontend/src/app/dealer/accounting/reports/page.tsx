'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ErrorAlert,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import { SeriesChart } from '@/components/charts';
import { StatTile } from '@/components/stat-tile';
import {
  Amount,
  DataTable,
  ExportButtons,
  RangeFilter,
  RangeLabel,
  Section,
  useAcctMutation,
  useAcctQuery,
  vehicleLabel,
} from '@/components/accounting/ui';
import {
  DEFAULT_RANGE,
  acct,
  isPreset,
  isoDate,
  money,
  percent,
  qs,
  rangeParams,
  todayIso,
  type Range,
  type RangeState,
} from '@/lib/accounting';

const REPORTS = [
  ['profit-loss', 'Profit and loss'],
  ['balance-sheet', 'Balance sheet'],
  ['cash-flow', 'Cash flow'],
  ['trial-balance', 'Trial balance'],
  ['vehicle-profitability', 'Vehicle profitability'],
  ['inventory-valuation', 'Inventory valuation'],
  ['kpis', 'Dealer KPIs'],
  ['monthly', 'Monthly report'],
  ['fiscal-year', 'Fiscal year'],
] as const;
type ReportKey = (typeof REPORTS)[number][0];

interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amountCents: number;
  compareCents?: number;
}
interface StatementSection {
  key: string;
  label: string;
  lines: StatementLine[];
  totalCents: number;
  compareTotalCents?: number;
}

function Reports() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params?.get('report');
  const report: ReportKey = REPORTS.some(([key]) => key === initial)
    ? (initial as ReportKey)
    : 'profit-loss';
  const [range, setRange] = useState<RangeState>({
    ...DEFAULT_RANGE,
    preset: 'CURRENT_FISCAL_YEAR',
  });
  const [compare, setCompare] = useState('NONE');
  const choose = (key: ReportKey) => router.replace(`/dealer/accounting/reports?report=${key}`);

  const filters = { ...rangeParams(range), compare };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every report is built from posted journal entries. Export any of them to CSV, Excel or
            PDF.
          </p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {REPORTS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === report}
            onClick={() => choose(key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${key === report ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {[
        'profit-loss',
        'balance-sheet',
        'cash-flow',
        'trial-balance',
        'vehicle-profitability',
        'kpis',
      ].includes(report) ? (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <RangeFilter value={range} onChange={setRange} />
            {report === 'profit-loss' || report === 'balance-sheet' ? (
              <Select
                aria-label="Compare"
                className="h-9 w-52"
                value={compare}
                onChange={(event) => setCompare(event.target.value)}
              >
                <option value="NONE">No comparison</option>
                <option value="PREVIOUS_PERIOD">Previous period</option>
                <option value="PREVIOUS_YEAR">Same period last year</option>
              </Select>
            ) : null}
          </div>
          <SavedFilters
            report={report}
            current={filters}
            onApply={(saved) => {
              const preset = String(saved['preset'] ?? '');
              if (isPreset(preset))
                setRange({
                  preset,
                  from: String(saved['from'] ?? ''),
                  to: String(saved['to'] ?? ''),
                });
              if (saved['compare']) setCompare(String(saved['compare']));
            }}
          />
        </div>
      ) : null}
      {report === 'profit-loss' ? <ProfitAndLoss filters={filters} /> : null}
      {report === 'balance-sheet' ? <BalanceSheet filters={filters} /> : null}
      {report === 'cash-flow' ? <CashFlow filters={rangeParams(range)} /> : null}
      {report === 'trial-balance' ? <TrialBalance filters={rangeParams(range)} /> : null}
      {report === 'vehicle-profitability' ? <VehicleProfitability range={range} /> : null}
      {report === 'inventory-valuation' ? <InventoryValuation /> : null}
      {report === 'kpis' ? <Kpis filters={rangeParams(range)} /> : null}
      {report === 'monthly' ? <Monthly /> : null}
      {report === 'fiscal-year' ? <FiscalYear /> : null}
    </>
  );
}

// --- Saved filters (the report builder's memory) ------------------------------------------

function SavedFilters({
  report,
  current,
  onApply,
}: {
  report: string;
  current: Record<string, string>;
  onApply: (filters: Record<string, unknown>) => void;
}) {
  const saved = useAcctQuery<Array<{ id: string; name: string; filters: Record<string, unknown> }>>(
    ['saved-filters', report],
    `/saved-filters${qs({ report })}`,
  );
  const [name, setName] = useState('');
  const save = useAcctMutation(
    () => acct.post('/saved-filters', { name, report, filters: current }),
    () => setName(''),
  );
  const remove = useAcctMutation((id: string) => acct.delete(`/saved-filters/${id}`));
  return (
    <div className="flex flex-wrap items-end gap-2">
      {saved.data && saved.data.length > 0 ? (
        <Select
          aria-label="Saved views"
          className="h-9 w-44"
          value=""
          onChange={(event) => {
            const found = saved.data?.find((entry) => entry.id === event.target.value);
            if (found) onApply(found.filters);
          }}
        >
          <option value="">Saved views…</option>
          {saved.data.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Input
        aria-label="Name for this view"
        placeholder="Save this view as…"
        className="h-9 w-44"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!name.trim()}
        loading={save.isPending}
        onClick={() => save.mutate(undefined)}
      >
        Save
      </Button>
      {saved.data && saved.data.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Manage</summary>
          <ul className="mt-1 space-y-1">
            {saved.data.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2">
                {entry.name}
                <button
                  type="button"
                  className="text-destructive hover:underline"
                  onClick={() => remove.mutate(entry.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// --- Statements --------------------------------------------------------------------------

function StatementTable({
  sections,
  compare,
  rows,
}: {
  sections: StatementSection[];
  compare: boolean;
  rows: Array<{ after: string; label: string; cents: number; compareCents?: number }>;
}) {
  const lineRow = (
    key: string,
    label: ReactNode,
    cents: number | null,
    compareCents: number | null | undefined,
    strong = false,
    indent = false,
  ) => (
    <tr key={key} className={strong ? 'border-t border-border font-semibold' : undefined}>
      <td className={`px-3 py-1.5 ${indent ? 'pl-8' : ''}`}>{label}</td>
      <td className="px-3 py-1.5 text-right">
        {cents === null ? null : <Amount cents={cents} strong={strong} />}
      </td>
      {compare ? (
        <td className="px-3 py-1.5 text-right text-muted-foreground">
          {compareCents === null || compareCents === undefined ? null : (
            <Amount cents={compareCents} />
          )}
        </td>
      ) : null}
    </tr>
  );
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-right">Amount</th>
              {compare ? <th className="px-3 py-2 text-right">Comparison</th> : null}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => [
              <tr key={`${section.key}-h`} className="bg-secondary/20">
                <td className="px-3 py-1.5 font-semibold" colSpan={compare ? 3 : 2}>
                  {section.label}
                </td>
              </tr>,
              ...section.lines.map((line) =>
                lineRow(
                  line.accountId,
                  <Link
                    href={`/dealer/accounting/ledger?accountId=${line.accountId}`}
                    className="hover:text-primary"
                  >
                    {line.code ? `${line.code} · ` : ''}
                    {line.name}
                  </Link>,
                  line.amountCents,
                  line.compareCents,
                  false,
                  true,
                ),
              ),
              lineRow(
                `${section.key}-t`,
                `Total ${section.label.toLowerCase()}`,
                section.totalCents,
                section.compareTotalCents,
                true,
              ),
              ...rows
                .filter((row) => row.after === section.key)
                .map((row) =>
                  lineRow(
                    `${section.key}-${row.label}`,
                    row.label,
                    row.cents,
                    row.compareCents,
                    true,
                  ),
                ),
            ])}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface ProfitAndLossData {
  range: Range;
  compareRange: Range | null;
  revenue: StatementSection;
  cogs: StatementSection;
  grossProfitCents: number;
  grossMarginBasisPoints: number | null;
  expenses: StatementSection;
  operatingIncomeCents: number;
  otherIncome: StatementSection;
  otherExpense: StatementSection;
  netIncomeCents: number;
  compare: {
    grossProfitCents: number;
    operatingIncomeCents: number;
    netIncomeCents: number;
  } | null;
  months: Array<{
    label: string;
    revenueCents: number;
    grossProfitCents: number;
    netIncomeCents: number;
  }> | null;
}

function ProfitAndLoss({ filters }: { filters: Record<string, string> }) {
  const [monthly, setMonthly] = useState(false);
  const { data, error, isPending } = useAcctQuery<ProfitAndLossData>(
    ['pl', filters, monthly],
    `/reports/profit-loss${qs({ ...filters, columns: monthly ? 'MONTHLY' : 'TOTAL' })}`,
  );
  if (error) return <ErrorAlert error={error} />;
  if (isPending || !data) return <Spinner />;
  const compare = Boolean(data.compare);
  const sections = [
    data.revenue,
    data.cogs,
    data.expenses,
    ...(data.otherIncome.lines.length ? [data.otherIncome] : []),
    ...(data.otherExpense.lines.length ? [data.otherExpense] : []),
  ];
  const last = sections[sections.length - 1]!.key;
  return (
    <Section
      title="Profit and loss"
      description={
        <>
          <RangeLabel range={data.range} />
          {data.compareRange
            ? ` · compared with ${data.compareRange.from} to ${data.compareRange.to}`
            : ''}
        </>
      }
      actions={
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={monthly}
              onChange={(event) => setMonthly(event.target.checked)}
            />{' '}
            By month
          </label>
          <ExportButtons report="profit-loss" params={filters} />
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Gross profit"
          value={money(data.grossProfitCents)}
          hint={`Margin ${percent(data.grossMarginBasisPoints)}`}
        />
        <StatTile label="Operating income" value={money(data.operatingIncomeCents)} />
        <StatTile
          label="Net income"
          value={money(data.netIncomeCents)}
          hint={data.compare ? `Comparison ${money(data.compare.netIncomeCents)}` : undefined}
        />
      </div>
      <StatementTable
        sections={sections}
        compare={compare}
        rows={[
          {
            after: 'COGS',
            label: 'Gross profit',
            cents: data.grossProfitCents,
            compareCents: data.compare?.grossProfitCents,
          },
          {
            after: 'OPERATING_EXPENSES',
            label: 'Operating income',
            cents: data.operatingIncomeCents,
            compareCents: data.compare?.operatingIncomeCents,
          },
          {
            after: last,
            label: 'Net income',
            cents: data.netIncomeCents,
            compareCents: data.compare?.netIncomeCents,
          },
        ]}
      />
      {data.months ? (
        <div className="mt-6">
          <DataTable
            dense
            rows={data.months}
            rowKey={(row) => row.label}
            columns={[
              { key: 'month', label: 'Month', render: (row) => row.label },
              {
                key: 'revenue',
                label: 'Revenue',
                align: 'right',
                render: (row) => <Amount cents={row.revenueCents} />,
              },
              {
                key: 'gross',
                label: 'Gross profit',
                align: 'right',
                render: (row) => <Amount cents={row.grossProfitCents} />,
              },
              {
                key: 'net',
                label: 'Net income',
                align: 'right',
                render: (row) => <Amount cents={row.netIncomeCents} strong />,
              },
            ]}
          />
        </div>
      ) : null}
    </Section>
  );
}

function BalanceSheet({ filters }: { filters: Record<string, string> }) {
  const { data, error, isPending } = useAcctQuery<{
    asOf: string;
    compareAsOf: string | null;
    sections: StatementSection[];
    totalAssetsCents: number;
    totalLiabilitiesCents: number;
    totalEquityCents: number;
    balanced: boolean;
    compare: {
      totalAssetsCents: number;
      totalLiabilitiesCents: number;
      totalEquityCents: number;
    } | null;
  }>(['bs', filters], `/reports/balance-sheet${qs(filters)}`);
  if (error) return <ErrorAlert error={error} />;
  if (isPending || !data) return <Spinner />;
  const sections = data.sections.filter((section) => section.lines.length > 0);
  return (
    <Section
      title="Balance sheet"
      description={`As of ${isoDate(data.asOf)}${data.compareAsOf ? ` · compared with ${isoDate(data.compareAsOf)}` : ''}`}
      actions={
        <>
          {data.balanced ? (
            <Badge variant="success">Assets = liabilities + equity</Badge>
          ) : (
            <Badge variant="destructive">Out of balance</Badge>
          )}
          <ExportButtons report="balance-sheet" params={filters} />
        </>
      }
    >
      <StatementTable
        sections={sections}
        compare={Boolean(data.compare)}
        rows={[
          {
            after: sections.find((section) => section.key === 'FIXED_ASSETS')
              ? 'FIXED_ASSETS'
              : 'CURRENT_ASSETS',
            label: 'Total assets',
            cents: data.totalAssetsCents,
            compareCents: data.compare?.totalAssetsCents,
          },
          {
            after: 'EQUITY',
            label: 'Total liabilities and equity',
            cents: data.totalLiabilitiesCents + data.totalEquityCents,
            compareCents: data.compare
              ? data.compare.totalLiabilitiesCents + data.compare.totalEquityCents
              : undefined,
          },
        ]}
      />
    </Section>
  );
}

function CashFlow({ filters }: { filters: Record<string, string> }) {
  type Part = { lines: StatementLine[]; totalCents: number };
  const { data, error, isPending } = useAcctQuery<{
    range: Range;
    netIncomeCents: number;
    operating: Part;
    investing: Part;
    financing: Part;
    netChangeCents: number;
    beginningCashCents: number;
    endingCashCents: number;
    reconciles: boolean;
  }>(['cf', filters], `/reports/cash-flow${qs(filters)}`);
  if (error) return <ErrorAlert error={error} />;
  if (isPending || !data) return <Spinner />;
  const part = (key: string, label: string, value: Part, extra: StatementLine[] = []) => ({
    key,
    label,
    lines: [...extra, ...value.lines],
    totalCents: value.totalCents,
  });
  return (
    <Section
      title="Cash flow statement"
      description={
        <>
          <RangeLabel range={data.range} /> · indirect method
        </>
      }
      actions={
        <>
          {data.reconciles ? (
            <Badge variant="success">Reconciles to cash</Badge>
          ) : (
            <Badge variant="destructive">Does not reconcile</Badge>
          )}
          <ExportButtons report="cash-flow" params={filters} />
        </>
      }
    >
      <StatementTable
        compare={false}
        sections={[
          part('OPERATING', 'Operating activities', data.operating, [
            {
              accountId: 'net-income',
              code: '',
              name: 'Net income',
              amountCents: data.netIncomeCents,
            },
          ]),
          part('INVESTING', 'Investing activities', data.investing),
          part('FINANCING', 'Financing activities', data.financing),
        ]}
        rows={[
          { after: 'FINANCING', label: 'Net change in cash', cents: data.netChangeCents },
          { after: 'FINANCING', label: 'Cash at the start', cents: data.beginningCashCents },
          { after: 'FINANCING', label: 'Cash at the end', cents: data.endingCashCents },
        ]}
      />
    </Section>
  );
}

function TrialBalance({ filters }: { filters: Record<string, string> }) {
  const { data, error, isPending } = useAcctQuery<{
    range: Range;
    rows: Array<{
      accountId: string;
      code: string;
      name: string;
      openingCents: number;
      debitCents: number;
      creditCents: number;
      closingDebitCents: number;
      closingCreditCents: number;
    }>;
    totals: {
      debitCents: number;
      creditCents: number;
      closingDebitCents: number;
      closingCreditCents: number;
    };
    balanced: boolean;
  }>(['tb', filters], `/reports/trial-balance${qs(filters)}`);
  return (
    <Section
      title="Trial balance"
      description={data ? <RangeLabel range={data.range} /> : undefined}
      actions={
        <>
          {data ? (
            data.balanced ? (
              <Badge variant="success">Debits = credits</Badge>
            ) : (
              <Badge variant="destructive">Out of balance</Badge>
            )
          ) : null}
          <ExportButtons report="trial-balance" params={filters} />
        </>
      }
    >
      <DataTable
        dense
        loading={isPending}
        error={error}
        rows={data?.rows}
        rowKey={(row) => row.accountId}
        columns={[
          {
            key: 'account',
            label: 'Account',
            render: (row) => (
              <Link
                href={`/dealer/accounting/ledger?accountId=${row.accountId}`}
                className="hover:text-primary"
              >
                {row.code} · {row.name}
              </Link>
            ),
          },
          {
            key: 'opening',
            label: 'Opening',
            align: 'right',
            render: (row) => <Amount cents={row.openingCents} muted />,
          },
          {
            key: 'debit',
            label: 'Debits',
            align: 'right',
            render: (row) => <Amount cents={row.debitCents} />,
          },
          {
            key: 'credit',
            label: 'Credits',
            align: 'right',
            render: (row) => <Amount cents={row.creditCents} />,
          },
          {
            key: 'cd',
            label: 'Closing Dr',
            align: 'right',
            render: (row) =>
              row.closingDebitCents ? <Amount cents={row.closingDebitCents} strong /> : null,
          },
          {
            key: 'cc',
            label: 'Closing Cr',
            align: 'right',
            render: (row) =>
              row.closingCreditCents ? <Amount cents={row.closingCreditCents} strong /> : null,
          },
        ]}
        footer={
          data ? (
            <tr>
              <td className="px-3 py-1.5">Totals</td>
              <td />
              <td className="px-3 py-1.5 text-right">
                <Amount cents={data.totals.debitCents} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <Amount cents={data.totals.creditCents} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <Amount cents={data.totals.closingDebitCents} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <Amount cents={data.totals.closingCreditCents} />
              </td>
            </tr>
          ) : null
        }
      />
    </Section>
  );
}

// --- Dealer reports ------------------------------------------------------------------------

interface VehicleRow {
  vehicleId: string;
  vin: string | null;
  stockNumber: string | null;
  year: number;
  make: string;
  model: string;
  totalCostCents: number;
  bookValueCents: number;
  acquiredOn: string | null;
  soldOn: string | null;
  daysInInventory: number | null;
  revenueCents: number;
  grossProfitCents: number | null;
  grossMarginBasisPoints: number | null;
  status: 'IN_STOCK' | 'SOLD';
  salesperson: { id: string; name: string } | null;
  purchaseCostCents: number;
  additionalCostsCents: number;
}

function VehicleProfitability({ range }: { range: RangeState }) {
  const [status, setStatus] = useState('');
  const [profitability, setProfitability] = useState('ALL');
  const [make, setMake] = useState('');
  const filters = { ...rangeParams(range), status, profitability, make };
  const { data, error, isPending } = useAcctQuery<{
    rows: VehicleRow[];
    totals: {
      vehicles: number;
      sold: number;
      totalCostCents: number;
      revenueCents: number;
      grossProfitCents: number;
    };
  }>(['vehicle-profitability', filters], `/reports/vehicle-profitability${qs(filters)}`);
  return (
    <Section
      title="Vehicle profitability"
      description="Each vehicle's cost, sale and gross profit — from journal lines tagged with the vehicle."
      actions={<ExportButtons report="vehicle-profitability" params={filters} />}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          aria-label="Status"
          className="h-9 w-36"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All vehicles</option>
          <option value="SOLD">Sold</option>
          <option value="IN_STOCK">In stock</option>
        </Select>
        <Select
          aria-label="Profitability"
          className="h-9 w-40"
          value={profitability}
          onChange={(event) => setProfitability(event.target.value)}
        >
          <option value="ALL">Any result</option>
          <option value="PROFITABLE">Profitable</option>
          <option value="LOSS">Sold at a loss</option>
        </Select>
        <Input
          aria-label="Make"
          placeholder="Make"
          className="h-9 w-36"
          value={make}
          onChange={(event) => setMake(event.target.value)}
        />
      </div>
      {data ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <StatTile
            label="Vehicles"
            value={`${data.totals.vehicles}`}
            hint={`${data.totals.sold} sold`}
          />
          <StatTile label="Total cost" value={money(data.totals.totalCostCents)} />
          <StatTile label="Revenue" value={money(data.totals.revenueCents)} />
          <StatTile label="Gross profit" value={money(data.totals.grossProfitCents)} />
        </div>
      ) : null}
      <DataTable
        dense
        loading={isPending}
        error={error}
        rows={data?.rows}
        rowKey={(row) => row.vehicleId}
        columns={[
          {
            key: 'vehicle',
            label: 'Vehicle',
            render: (row) => (
              <Link
                href={`/dealer/accounting/vehicles/${row.vehicleId}`}
                className="text-primary hover:underline"
              >
                {vehicleLabel(row)}
              </Link>
            ),
          },
          {
            key: 'status',
            label: 'Status',
            render: (row) =>
              row.status === 'SOLD' ? (
                <Badge variant="success">Sold</Badge>
              ) : (
                <Badge variant="outline">In stock</Badge>
              ),
          },
          {
            key: 'days',
            label: 'Days',
            align: 'right',
            render: (row) => row.daysInInventory ?? '—',
          },
          {
            key: 'cost',
            label: 'Total cost',
            align: 'right',
            render: (row) => <Amount cents={row.totalCostCents} />,
          },
          {
            key: 'revenue',
            label: 'Revenue',
            align: 'right',
            render: (row) => (row.status === 'SOLD' ? <Amount cents={row.revenueCents} /> : '—'),
          },
          {
            key: 'profit',
            label: 'Gross profit',
            align: 'right',
            render: (row) =>
              row.grossProfitCents === null ? '—' : <Amount cents={row.grossProfitCents} strong />,
          },
          {
            key: 'margin',
            label: 'Margin',
            align: 'right',
            render: (row) => percent(row.grossMarginBasisPoints),
          },
          {
            key: 'salesperson',
            label: 'Salesperson',
            render: (row) => row.salesperson?.name ?? '—',
          },
        ]}
      />
    </Section>
  );
}

function InventoryValuation() {
  const { data, error, isPending } = useAcctQuery<{
    asOf: string;
    rows: VehicleRow[];
    units: number;
    totalCents: number;
    ledgerBalanceCents: number;
    differenceCents: number;
    averageDaysInStock: number;
  }>(['inventory-valuation'], '/reports/inventory-valuation');
  return (
    <Section
      title="Inventory valuation"
      description={data ? `As of ${isoDate(data.asOf)}, at book value.` : undefined}
      actions={<ExportButtons report="inventory-valuation" />}
    >
      {data ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <StatTile label="Units" value={data.units} />
          <StatTile label="Book value" value={money(data.totalCents)} />
          <StatTile
            label="Vehicle Inventory account"
            value={money(data.ledgerBalanceCents)}
            hint={
              data.differenceCents
                ? `Differs by ${money(data.differenceCents)}`
                : 'Matches the vehicles'
            }
          />
          <StatTile label="Average days in stock" value={data.averageDaysInStock} />
        </div>
      ) : null}
      <DataTable
        dense
        loading={isPending}
        error={error}
        rows={data?.rows}
        rowKey={(row) => row.vehicleId}
        columns={[
          {
            key: 'vehicle',
            label: 'Vehicle',
            render: (row) => (
              <Link
                href={`/dealer/accounting/vehicles/${row.vehicleId}`}
                className="text-primary hover:underline"
              >
                {vehicleLabel(row)}
              </Link>
            ),
          },
          { key: 'acquired', label: 'Acquired', render: (row) => isoDate(row.acquiredOn) },
          {
            key: 'days',
            label: 'Days',
            align: 'right',
            render: (row) => (
              <span
                className={
                  (row.daysInInventory ?? 0) > 90 ? 'font-semibold text-warning' : undefined
                }
              >
                {row.daysInInventory ?? '—'}
              </span>
            ),
          },
          {
            key: 'purchase',
            label: 'Purchase',
            align: 'right',
            render: (row) => <Amount cents={row.purchaseCostCents} />,
          },
          {
            key: 'extra',
            label: 'Additional',
            align: 'right',
            render: (row) => <Amount cents={row.additionalCostsCents} />,
          },
          {
            key: 'book',
            label: 'Book value',
            align: 'right',
            render: (row) => <Amount cents={row.bookValueCents} strong />,
          },
        ]}
      />
    </Section>
  );
}

interface KpiGroup {
  key: string;
  units: number;
  revenueCents: number;
  grossProfitCents: number;
}

function Kpis({ filters }: { filters: Record<string, string> }) {
  const { data, error, isPending } = useAcctQuery<{
    range: Range;
    unitsSold: number;
    averageSellingPriceCents: number;
    averageGrossProfitCents: number;
    grossMarginBasisPoints: number | null;
    inventoryTurnover: number | null;
    averageDaysInInventory: number | null;
    averageVehicleCostCents: number;
    reconditioningPerVehicleCents: number;
    advertisingPerVehicleCents: number;
    revenuePerUnitCents: number;
    expensePerUnitCents: number;
    netProfitPerUnitCents: number;
    bySalesperson: KpiGroup[];
    byBrand: KpiGroup[];
    byVehicleType: KpiGroup[];
  }>(['kpis', filters], `/reports/kpis${qs(filters)}`);
  if (error) return <ErrorAlert error={error} />;
  if (isPending || !data) return <Spinner />;
  const group = (title: string, rows: KpiGroup[]) => (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <DataTable
        dense
        rows={rows}
        rowKey={(row) => row.key}
        empty={
          <p className="px-4 py-4 text-center text-sm text-muted-foreground">
            No sales in this period.
          </p>
        }
        columns={[
          { key: 'key', label: '', render: (row) => row.key },
          { key: 'units', label: 'Units', align: 'right', render: (row) => row.units },
          {
            key: 'revenue',
            label: 'Revenue',
            align: 'right',
            render: (row) => <Amount cents={row.revenueCents} />,
          },
          {
            key: 'profit',
            label: 'Gross profit',
            align: 'right',
            render: (row) => <Amount cents={row.grossProfitCents} />,
          },
        ]}
      />
    </div>
  );
  return (
    <Section
      title="Dealer KPIs"
      description={<RangeLabel range={data.range} />}
      actions={<ExportButtons report="kpis" params={filters} />}
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Units sold" value={data.unitsSold} />
        <StatTile label="Average selling price" value={money(data.averageSellingPriceCents)} />
        <StatTile
          label="Average gross / vehicle"
          value={money(data.averageGrossProfitCents)}
          hint={`Margin ${percent(data.grossMarginBasisPoints)}`}
        />
        <StatTile
          label="Inventory turnover"
          value={data.inventoryTurnover === null ? '—' : `${data.inventoryTurnover}×`}
          hint={`Average ${data.averageDaysInInventory ?? '—'} days in stock`}
        />
        <StatTile label="Average vehicle cost" value={money(data.averageVehicleCostCents)} />
        <StatTile
          label="Reconditioning / vehicle"
          value={money(data.reconditioningPerVehicleCents)}
        />
        <StatTile
          label="Advertising / vehicle sold"
          value={money(data.advertisingPerVehicleCents)}
        />
        <StatTile
          label="Net profit / unit"
          value={money(data.netProfitPerUnitCents)}
          hint={`Revenue ${money(data.revenuePerUnitCents)} · expenses ${money(data.expensePerUnitCents)}`}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {group('By salesperson', data.bySalesperson)}
        {group('By brand', data.byBrand)}
        {group('By body type', data.byVehicleType)}
      </div>
    </Section>
  );
}

type Figures = Record<
  | 'revenueCents'
  | 'cogsCents'
  | 'grossProfitCents'
  | 'expensesCents'
  | 'netProfitCents'
  | 'unitsSold'
  | 'averageSalePriceCents'
  | 'averageGrossProfitCents'
  | 'taxCollectedCents'
  | 'taxPaidCents'
  | 'taxPayableCents'
  | 'netCashFlowCents'
  | 'arCents'
  | 'apCents'
  | 'inventoryCents',
  number
>;

const FIGURES: Array<[keyof Figures, string, 'money' | 'count']> = [
  ['revenueCents', 'Revenue', 'money'],
  ['cogsCents', 'Cost of sales', 'money'],
  ['grossProfitCents', 'Gross profit', 'money'],
  ['expensesCents', 'Expenses', 'money'],
  ['netProfitCents', 'Net profit', 'money'],
  ['unitsSold', 'Vehicles sold', 'count'],
  ['averageSalePriceCents', 'Average sale price', 'money'],
  ['averageGrossProfitCents', 'Average gross profit', 'money'],
  ['taxCollectedCents', 'Tax collected', 'money'],
  ['taxPaidCents', 'Tax paid', 'money'],
  ['taxPayableCents', 'Net tax payable', 'money'],
  ['netCashFlowCents', 'Net cash flow', 'money'],
  ['arCents', 'Accounts receivable', 'money'],
  ['apCents', 'Accounts payable', 'money'],
  ['inventoryCents', 'Inventory', 'money'],
];

function ComparisonTable({
  current,
  previous,
  currentLabel,
  previousLabel,
}: {
  current: Figures;
  previous: Figures;
  currentLabel: string;
  previousLabel: string;
}) {
  return (
    <DataTable
      dense
      rows={FIGURES}
      rowKey={(row) => row[0]}
      columns={[
        { key: 'metric', label: 'Metric', render: ([, label]) => label },
        {
          key: 'current',
          label: currentLabel,
          align: 'right',
          render: ([key, , kind]) =>
            kind === 'money' ? <Amount cents={current[key]} strong /> : current[key],
        },
        {
          key: 'previous',
          label: previousLabel,
          align: 'right',
          render: ([key, , kind]) =>
            kind === 'money' ? <Amount cents={previous[key]} muted /> : previous[key],
        },
        {
          key: 'change',
          label: 'Change',
          align: 'right',
          render: ([key, , kind]) =>
            kind === 'money' ? (
              <Amount cents={current[key] - previous[key]} />
            ) : (
              current[key] - previous[key]
            ),
        },
      ]}
    />
  );
}

function Monthly() {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [compare, setCompare] = useState('PREVIOUS_MONTH');
  const { data, error, isPending } = useAcctQuery<{
    month: string;
    compareRange: Range;
    current: Figures;
    previous: Figures;
  }>(['monthly', month, compare], `/reports/monthly${qs({ month, compare })}`);
  return (
    <Section
      title="Monthly report"
      actions={
        <>
          <Input
            type="month"
            aria-label="Month"
            className="h-9 w-40"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <Select
            aria-label="Compare with"
            className="h-9 w-52"
            value={compare}
            onChange={(event) => setCompare(event.target.value)}
          >
            <option value="PREVIOUS_MONTH">Previous month</option>
            <option value="SAME_MONTH_LAST_YEAR">Same month last year</option>
          </Select>
          <ExportButtons
            report="monthly"
            params={{
              month,
              compare: compare === 'SAME_MONTH_LAST_YEAR' ? 'PREVIOUS_YEAR' : 'PREVIOUS_PERIOD',
            }}
          />
        </>
      }
    >
      {error ? (
        <ErrorAlert error={error} />
      ) : isPending || !data ? (
        <Spinner />
      ) : (
        <ComparisonTable
          current={data.current}
          previous={data.previous}
          currentLabel={data.month}
          previousLabel={`${data.compareRange.from} – ${data.compareRange.to}`}
        />
      )}
    </Section>
  );
}

function FiscalYear() {
  const [which, setWhich] = useState('CURRENT');
  const { data, error, isPending } = useAcctQuery<{
    range: Range;
    compareRange: Range;
    current: Figures;
    previous: Figures;
    months: Array<{ label: string; revenueCents: number; netIncomeCents: number }>;
  }>(['fiscal-year', which], `/reports/fiscal-year${qs({ which })}`);
  return (
    <Section
      title="Fiscal year"
      description={data ? <RangeLabel range={data.range} /> : undefined}
      actions={
        <Select
          aria-label="Year"
          className="h-9 w-48"
          value={which}
          onChange={(event) => setWhich(event.target.value)}
        >
          <option value="CURRENT">Current fiscal year</option>
          <option value="PREVIOUS">Previous fiscal year</option>
        </Select>
      }
    >
      {error ? (
        <ErrorAlert error={error} />
      ) : isPending || !data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-5">
                <p className="mb-2 text-sm font-semibold">Revenue by month</p>
                <SeriesChart
                  kind="bar"
                  tone="primary"
                  height={220}
                  data={data.months.map((month) => ({
                    date: month.label,
                    value: month.revenueCents / 100,
                  }))}
                  formatValue={(value) => money(Math.round(value * 100))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="mb-2 text-sm font-semibold">Net income by month</p>
                <SeriesChart
                  kind="line"
                  tone="accent"
                  height={220}
                  data={data.months.map((month) => ({
                    date: month.label,
                    value: month.netIncomeCents / 100,
                  }))}
                  formatValue={(value) => money(Math.round(value * 100))}
                />
              </CardContent>
            </Card>
          </div>
          <ComparisonTable
            current={data.current}
            previous={data.previous}
            currentLabel="This year"
            previousLabel={`${data.compareRange.from} – ${data.compareRange.to}`}
          />
        </>
      )}
    </Section>
  );
}

export default function ReportsPage() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}
