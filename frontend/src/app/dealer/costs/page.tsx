'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, Receipt, Search, Wrench, Layers } from 'lucide-react';
import {
  COST_OVERVIEW_SCOPES,
  COST_OVERVIEW_SCOPE_LABELS,
  COST_OVERVIEW_SORTS,
  COST_OVERVIEW_SORT_LABELS,
  formatCents,
  type CostOverviewPage,
  type CostOverviewRow,
  type CostOverviewScope,
  type CostOverviewSort,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatPrice } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Input,
  Pagination,
  Select,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { DealerNav } from '@/components/dealer-nav';
import { StatTile } from '@/components/stat-tile';
import { STATUS_VARIANT, shortDate } from '../inventory/inventory-items';
import { Margin } from './margin';

function CostOverview() {
  const [scope, setScope] = useState<CostOverviewScope>('IN_STOCK');
  const [sort, setSort] = useState<CostOverviewSort>('updated_desc');
  const [withCostsOnly, setWithCostsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const query = new URLSearchParams({ scope, sort, page: String(page), pageSize: '20' });
  if (search) query.set('q', search);
  if (withCostsOnly) query.set('withCostsOnly', 'true');

  const { data, isPending, error } = useQuery({
    queryKey: ['dealer-costs', query.toString()],
    queryFn: () => api.get<CostOverviewPage>(`/dealer/costs?${query.toString()}`),
    placeholderData: (previous) => previous,
  });

  const summary = data?.summary;
  const items = data?.items ?? [];

  return (
    <div className="container py-8">
      <DashboardNav />
      <DealerNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Cost Management</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          What each vehicle cost you to buy and prepare, against its price. Costs are private to
          your dealership.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {COST_OVERVIEW_SCOPES.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={entry === scope}
            onClick={() => {
              setScope(entry);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              entry === scope
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {COST_OVERVIEW_SCOPE_LABELS[entry]}
          </button>
        ))}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total inventory cost"
          value={summary ? formatCents(summary.totalCostCents) : '—'}
          hint={
            summary
              ? `${summary.costedVehicleCount} of ${summary.vehicleCount} vehicles costed`
              : undefined
          }
          icon={Calculator}
        />
        <StatTile
          label="Total repair cost"
          value={summary ? formatCents(summary.repairCents) : '—'}
          hint="Mechanical, body, parts and tires"
          icon={Wrench}
        />
        <StatTile
          label="Total other costs"
          value={summary ? formatCents(summary.otherCents) : '—'}
          hint="Fees, transport, inspection, detailing and more"
          icon={Layers}
        />
        <StatTile
          label="Average cost / vehicle"
          value={summary?.averageCostCents != null ? formatCents(summary.averageCostCents) : '—'}
          hint={
            summary?.averageGrossMarginCents != null
              ? `Average gross margin ${formatCents(summary.averageGrossMarginCents)}`
              : 'Over vehicles with costs recorded'
          }
          icon={Receipt}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            className="pl-9"
            placeholder="Search by VIN, stock #, make or model"
            aria-label="Search vehicles"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={withCostsOnly}
            onChange={(event) => {
              setWithCostsOnly(event.target.checked);
              setPage(1);
            }}
          />
          Only vehicles with costs
        </label>
        <Select
          aria-label="Sort by"
          className="w-auto"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as CostOverviewSort);
            setPage(1);
          }}
        >
          {COST_OVERVIEW_SORTS.map((option) => (
            <option key={option} value={option}>
              {COST_OVERVIEW_SORT_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      <ErrorAlert error={error} className="mb-4" />

      {isPending ? (
        <Spinner label="Loading costs" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={search ? `Nothing matches "${search}"` : 'No vehicles here'}
            description={
              withCostsOnly
                ? 'No vehicle in this view has a cost recorded yet. Open a vehicle to add its purchase cost and any other costs.'
                : 'Vehicles in this view appear here with their costs and gross margin.'
            }
            action={
              <Link href="/dealer/inventory">
                <Button variant="outline">Go to inventory</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="border-b border-border bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-3">
                      Vehicle
                    </th>
                    <th scope="col" className="px-3 py-3">
                      VIN
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Purchase cost
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Additional costs
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Total cost
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Sale price
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Gross margin
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Last updated
                    </th>
                    <th scope="col" className="px-3 py-3 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((row) => (
                    <tr key={row.vehicleId} className="hover:bg-secondary/40">
                      <td className="px-3 py-2">
                        <Link
                          href={`/dealer/costs/${row.vehicleId}`}
                          className="font-semibold hover:text-primary"
                        >
                          {row.title}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant={STATUS_VARIANT[row.status]}>
                            {formatEnum(row.status)}
                          </Badge>
                          {row.stockNumber ? <span>Stock #{row.stockNumber}</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.vin ?? '—'}</td>
                      <td className="tabular px-3 py-2 text-right">
                        {money(row, row.purchaseCents)}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {money(row, row.additionalCents)}
                      </td>
                      <td className="tabular px-3 py-2 text-right font-semibold">
                        {money(row, row.totalCents)}
                      </td>
                      <td className="tabular px-3 py-2 text-right">{formatPrice(row.priceCad)}</td>
                      <td className="px-3 py-2 text-right">
                        <Margin cents={row.grossMarginCents} />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.costsUpdatedAt ? shortDate(row.costsUpdatedAt) : 'No costs yet'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/dealer/costs/${row.vehicleId}`}>
                          <Button size="sm" variant="outline">
                            {row.costCount > 0 ? 'Manage costs' : 'Add costs'}
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:hidden">
            {items.map((row) => (
              <Card key={row.vehicleId}>
                <CardContent className="flex flex-col gap-2 pt-4 text-sm">
                  <Link
                    href={`/dealer/costs/${row.vehicleId}`}
                    className="font-semibold hover:text-primary"
                  >
                    {row.title}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={STATUS_VARIANT[row.status]}>{formatEnum(row.status)}</Badge>
                    <span className="truncate font-mono">{row.vin ?? 'No VIN'}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Purchase</dt>
                    <dd className="tabular text-right">{money(row, row.purchaseCents)}</dd>
                    <dt className="text-muted-foreground">Additional</dt>
                    <dd className="tabular text-right">{money(row, row.additionalCents)}</dd>
                    <dt className="text-muted-foreground">Total cost</dt>
                    <dd className="tabular text-right font-semibold">
                      {money(row, row.totalCents)}
                    </dd>
                    <dt className="text-muted-foreground">Sale price</dt>
                    <dd className="tabular text-right">{formatPrice(row.priceCad)}</dd>
                    <dt className="text-muted-foreground">Gross margin</dt>
                    <dd className="text-right">
                      <Margin cents={row.grossMarginCents} />
                    </dd>
                  </dl>
                  <Link href={`/dealer/costs/${row.vehicleId}`} className="mt-1">
                    <Button size="sm" variant="outline" className="w-full">
                      {row.costCount > 0 ? 'Manage costs' : 'Add costs'}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Gross margin is the sale price less the total cost. It is an estimate, not profit: it
            leaves out overheads, commissions and taxes.
          </p>
          {data ? (
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** An amount, or a dash on a vehicle with nothing recorded. */
function money(row: CostOverviewRow, cents: number) {
  return row.costCount === 0 ? '—' : formatCents(cents);
}

export default function CostOverviewPage() {
  return (
    <RequireAuth sellersOnly>
      <CostOverview />
    </RequireAuth>
  );
}
