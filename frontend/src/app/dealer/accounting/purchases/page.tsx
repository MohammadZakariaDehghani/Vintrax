'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  ACQUISITION_METHODS,
  ACQUISITION_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type AcquisitionMethod,
} from '@vintrax/shared';
import { Button, Dialog, ErrorAlert, Field, Input, Select, Textarea } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { BankSelect, VehicleSelect, VendorSelect } from '@/components/accounting/pickers';
import {
  Amount,
  Can,
  DataTable,
  MoneyInput,
  PageHeader,
  RangeFilter,
  ReasonDialog,
  StatusBadge,
  fieldError,
  useAcctMutation,
  useAcctQuery,
  vehicleLabel,
} from '@/components/accounting/ui';
import {
  DEFAULT_RANGE,
  acct,
  isoDate,
  money,
  qs,
  rangeParams,
  todayIso,
  type RangeState,
} from '@/lib/accounting';
import { parseMoneyToCents } from '@vintrax/shared';
import { formatEnum } from '@/lib/utils';

interface Acquisition {
  id: string;
  date: string;
  method: AcquisitionMethod;
  vehicle: {
    id: string;
    vin: string | null;
    year: number;
    make: string;
    model: string;
    stockNumber: string | null;
  };
  vendor: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  purchasePriceCents: number;
  additionalCostsCents: number;
  taxCents: number;
  totalCents: number;
  settlement: string;
  status: string;
  journalEntryId: string | null;
  reference: string | null;
}

export default function PurchasesPage() {
  const { can } = useAccounting();
  const [range, setRange] = useState<RangeState>({
    ...DEFAULT_RANGE,
    preset: 'CURRENT_FISCAL_YEAR',
  });
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<Acquisition | null>(null);
  const filters = rangeParams(range);
  const list = useAcctQuery<{ items: Acquisition[] }>(
    ['acquisitions', filters],
    `/acquisitions${qs(filters)}`,
  );

  return (
    <>
      <PageHeader
        title="Vehicle purchases"
        description="What each vehicle cost to acquire and prepare goes into Vehicle Inventory and becomes its cost of sale when it sells."
        actions={
          <Can permission="accounting.post">
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Record a purchase
            </Button>
          </Can>
        }
      />
      <div className="mb-4">
        <RangeFilter value={range} onChange={setRange} />
      </div>
      <DataTable
        loading={list.isPending}
        error={list.error}
        rows={list.data?.items}
        rowKey={(row) => row.id}
        columns={[
          { key: 'date', label: 'Date', render: (row) => isoDate(row.date) },
          {
            key: 'vehicle',
            label: 'Vehicle',
            render: (row) => (
              <Link
                href={`/dealer/accounting/vehicles/${row.vehicle.id}`}
                className="text-primary hover:underline"
              >
                {vehicleLabel(row.vehicle)}
              </Link>
            ),
          },
          {
            key: 'method',
            label: 'Bought',
            render: (row) => ACQUISITION_METHOD_LABELS[row.method],
          },
          {
            key: 'from',
            label: 'From',
            render: (row) => row.vendor?.name ?? row.customer?.name ?? '—',
          },
          { key: 'settlement', label: 'Paid', render: (row) => formatEnum(row.settlement) },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          {
            key: 'price',
            label: 'Price',
            align: 'right',
            render: (row) => <Amount cents={row.purchasePriceCents} />,
          },
          {
            key: 'extra',
            label: 'Fees & prep',
            align: 'right',
            render: (row) => <Amount cents={row.additionalCostsCents} />,
          },
          {
            key: 'total',
            label: 'Total',
            align: 'right',
            render: (row) => <Amount cents={row.totalCents} strong />,
          },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) => (
              <span className="flex justify-end gap-1">
                {row.journalEntryId ? (
                  <Link href={`/dealer/accounting/journal/${row.journalEntryId}`}>
                    <Button size="sm" variant="ghost">
                      Entry
                    </Button>
                  </Link>
                ) : null}
                {row.status === 'POSTED' && can('accounting.reverse') ? (
                  <Button size="sm" variant="ghost" onClick={() => setVoiding(row)}>
                    Void
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      {creating ? <PurchaseDialog onClose={() => setCreating(false)} /> : null}
      <ReasonDialog
        open={Boolean(voiding)}
        title="Void this purchase"
        description="Reverses the purchase entry and takes the vehicle's cost back out of inventory. A sold vehicle's purchase cannot be voided."
        confirmLabel="Void purchase"
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => acct.post(`/acquisitions/${voiding!.id}/void`, { reason })}
      />
    </>
  );
}

function PurchaseDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    vehicleId: '',
    method: 'AUCTION' as AcquisitionMethod,
    vendorId: '',
    date: todayIso(),
    purchasePrice: '',
    auctionFee: '',
    transportation: '',
    inspection: '',
    reconditioning: '',
    otherCosts: '',
    vendorChargedTax: false,
    settlement: 'PAID',
    paymentMethod: 'BANK_TRANSFER',
    bankAccountId: '',
    dueDate: '',
    lenderVendorId: '',
    principal: '',
    interestRate: '',
    maturityDate: '',
    reference: '',
    notes: '',
  });
  const set = (key: keyof typeof form) => (value: string | boolean) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const total = [
    'purchasePrice',
    'auctionFee',
    'transportation',
    'inspection',
    'reconditioning',
    'otherCosts',
  ].reduce(
    (sum, key) => sum + (parseMoneyToCents((form[key as keyof typeof form] as string) || '0') ?? 0),
    0,
  );
  const save = useAcctMutation(
    () =>
      acct.post('/acquisitions', {
        vehicleId: form.vehicleId,
        method: form.method,
        vendorId: form.vendorId || null,
        date: form.date,
        purchasePrice: form.purchasePrice,
        auctionFee: form.auctionFee || '0',
        transportation: form.transportation || '0',
        inspection: form.inspection || '0',
        reconditioning: form.reconditioning || '0',
        otherCosts: form.otherCosts || '0',
        vendorChargedTax: form.vendorChargedTax,
        settlement: form.settlement,
        paymentMethod: form.settlement === 'PAID' ? form.paymentMethod : null,
        bankAccountId: form.settlement === 'PAID' ? form.bankAccountId : null,
        dueDate: form.settlement === 'ON_ACCOUNT' ? form.dueDate || null : null,
        floorPlan:
          form.settlement === 'FLOOR_PLAN'
            ? {
                lenderVendorId: form.lenderVendorId,
                principal: form.principal || '0',
                interestRate: form.interestRate || '0',
                maturityDate: form.maturityDate || null,
                reference: null,
              }
            : null,
        reference: form.reference || null,
        notes: form.notes || null,
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Record a vehicle purchase"
      footer={
        <>
          <span className="mr-auto self-center text-sm">Landed cost {money(total)}</span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.vehicleId || !form.purchasePrice}
            onClick={() => save.mutate(undefined)}
          >
            Post purchase
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Vehicle"
          htmlFor="pu-vehicle"
          className="sm:col-span-3"
          error={fieldError(save.error, 'vehicleId')}
          hint="The listing in your inventory. Add the vehicle under Add vehicle first if it is not there."
        >
          <VehicleSelect
            id="pu-vehicle"
            value={form.vehicleId}
            onChange={(id) => set('vehicleId')(id)}
          />
        </Field>
        <Field label="Bought" htmlFor="pu-method" error={fieldError(save.error, 'method')}>
          <Select
            id="pu-method"
            value={form.method}
            onChange={(event) => set('method')(event.target.value)}
          >
            {ACQUISITION_METHODS.filter((method) => method !== 'TRADE_IN').map((method) => (
              <option key={method} value={method}>
                {ACQUISITION_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="From"
          htmlFor="pu-vendor"
          className="sm:col-span-2"
          error={fieldError(save.error, 'vendorId')}
        >
          <VendorSelect
            id="pu-vendor"
            value={form.vendorId}
            onChange={(id) => set('vendorId')(id)}
          />
        </Field>
        <Field label="Date" htmlFor="pu-date">
          <Input
            id="pu-date"
            type="date"
            value={form.date}
            onChange={(event) => set('date')(event.target.value)}
          />
        </Field>
        <Field
          label="Purchase price"
          htmlFor="pu-price"
          error={fieldError(save.error, 'purchasePrice')}
        >
          <MoneyInput id="pu-price" value={form.purchasePrice} onChange={set('purchasePrice')} />
        </Field>
        <Field label="Auction / buyer fee" htmlFor="pu-auction">
          <MoneyInput id="pu-auction" value={form.auctionFee} onChange={set('auctionFee')} />
        </Field>
        <Field label="Transportation" htmlFor="pu-transport">
          <MoneyInput
            id="pu-transport"
            value={form.transportation}
            onChange={set('transportation')}
          />
        </Field>
        <Field label="Inspection" htmlFor="pu-inspection">
          <MoneyInput id="pu-inspection" value={form.inspection} onChange={set('inspection')} />
        </Field>
        <Field label="Reconditioning" htmlFor="pu-recon">
          <MoneyInput id="pu-recon" value={form.reconditioning} onChange={set('reconditioning')} />
        </Field>
        <Field label="Other costs" htmlFor="pu-other">
          <MoneyInput id="pu-other" value={form.otherCosts} onChange={set('otherCosts')} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={form.vendorChargedTax}
            onChange={(event) => set('vendorChargedTax')(event.target.checked)}
          />
          The seller charged GST/HST (claimed back as an input tax credit)
        </label>
        <Field label="Settlement" htmlFor="pu-settlement" className="sm:col-span-3">
          <Select
            id="pu-settlement"
            value={form.settlement}
            onChange={(event) => set('settlement')(event.target.value)}
          >
            <option value="PAID">Paid now</option>
            <option value="ON_ACCOUNT">On account (a bill to pay later)</option>
            <option value="FLOOR_PLAN">Floor plan (financed by a lender)</option>
          </Select>
        </Field>
        {form.settlement === 'PAID' ? (
          <>
            <Field label="Paid by" htmlFor="pu-paymethod">
              <Select
                id="pu-paymethod"
                value={form.paymentMethod}
                onChange={(event) => set('paymentMethod')(event.target.value)}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="From account"
              htmlFor="pu-bank"
              className="sm:col-span-2"
              error={fieldError(save.error, 'bankAccountId')}
            >
              <BankSelect
                id="pu-bank"
                value={form.bankAccountId}
                onChange={(id) => set('bankAccountId')(id)}
              />
            </Field>
          </>
        ) : null}
        {form.settlement === 'ON_ACCOUNT' ? (
          <Field label="Due" htmlFor="pu-due">
            <Input
              id="pu-due"
              type="date"
              value={form.dueDate}
              onChange={(event) => set('dueDate')(event.target.value)}
            />
          </Field>
        ) : null}
        {form.settlement === 'FLOOR_PLAN' ? (
          <>
            <Field
              label="Floor plan lender"
              htmlFor="pu-lender"
              className="sm:col-span-3"
              error={fieldError(save.error, 'floorPlan')}
            >
              <VendorSelect
                id="pu-lender"
                kind="LENDER"
                value={form.lenderVendorId}
                onChange={(id) => set('lenderVendorId')(id)}
              />
            </Field>
            <Field label="Amount advanced" htmlFor="pu-principal" hint="Blank: the purchase price.">
              <MoneyInput id="pu-principal" value={form.principal} onChange={set('principal')} />
            </Field>
            <Field label="Interest rate %" htmlFor="pu-rate">
              <Input
                id="pu-rate"
                inputMode="decimal"
                value={form.interestRate}
                onChange={(event) => set('interestRate')(event.target.value)}
              />
            </Field>
            <Field label="Matures" htmlFor="pu-maturity">
              <Input
                id="pu-maturity"
                type="date"
                value={form.maturityDate}
                onChange={(event) => set('maturityDate')(event.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field
          label="Invoice / reference"
          htmlFor="pu-ref"
          error={fieldError(save.error, 'reference')}
        >
          <Input
            id="pu-ref"
            value={form.reference}
            onChange={(event) => set('reference')(event.target.value)}
          />
        </Field>
        <Field label="Notes" htmlFor="pu-notes" className="sm:col-span-2">
          <Textarea
            id="pu-notes"
            className="min-h-[40px]"
            value={form.notes}
            onChange={(event) => set('notes')(event.target.value)}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}
