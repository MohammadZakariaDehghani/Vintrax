'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  BODY_TYPES,
  DRIVETRAINS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  VEHICLE_CONDITIONS,
} from '@vintrax/shared';
import { Button, Dialog, ErrorAlert, Field, Input, Select, Textarea } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { BankSelect, CustomerSelect, VehicleSelect, VendorSelect } from '@/components/accounting/pickers';
import { Amount, Can, DataTable, MoneyInput, PageHeader, Section, StatusBadge, fieldError, useAcctMutation, useAcctQuery, vehicleLabel } from '@/components/accounting/ui';
import { acct, centsInput, isoDate, todayIso } from '@/lib/accounting';
import { formatEnum } from '@/lib/utils';

interface Deposit {
  id: string;
  number: number;
  customer: { id: string; name: string };
  vehicle: { id: string; vin: string | null; year: number; make: string; model: string; stockNumber: string | null } | null;
  date: string;
  amountCents: number;
  appliedCents: number;
  refundedCents: number;
  remainingCents: number;
  method: string;
  status: string;
  journalEntryId: string | null;
}

interface TradeIn {
  id: string;
  customer: { id: string; name: string };
  vehicleId: string;
  sale: { id: string; number: number } | null;
  vin: string | null;
  year: number;
  make: string;
  model: string;
  mileageKm: number | null;
  appraisedValueCents: number;
  tradeAllowanceCents: number;
  lienPayoffCents: number;
  lienHolder: { id: string; name: string } | null;
  netTradeValueCents: number;
  status: string;
}

export default function DepositsPage() {
  const { can } = useAccounting();
  const deposits = useAcctQuery<Deposit[]>(['deposits'], '/deposits');
  const tradeIns = useAcctQuery<TradeIn[]>(['trade-ins'], '/trade-ins');
  const [taking, setTaking] = useState(false);
  const [refunding, setRefunding] = useState<Deposit | null>(null);
  const [appraising, setAppraising] = useState(false);
  const withdraw = useAcctMutation((id: string) => acct.post(`/trade-ins/${id}/withdraw`));

  return (
    <>
      <PageHeader
        title="Deposits and trade-ins"
        description="A deposit is money held for the customer — a liability until the sale. A trade-in is appraised here and bought into inventory at its actual cash value when the sale posts."
      />
      <Section
        title="Customer deposits"
        actions={
          <Can permission="accounting.post_sales">
            <Button onClick={() => setTaking(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Take a deposit
            </Button>
          </Can>
        }
      >
        <DataTable
          loading={deposits.isPending}
          error={deposits.error}
          rows={deposits.data}
          rowKey={(row) => row.id}
          columns={[
            { key: 'number', label: 'No.', render: (row) => `#${row.number}` },
            { key: 'date', label: 'Date', render: (row) => isoDate(row.date) },
            { key: 'customer', label: 'Customer', render: (row) => row.customer.name },
            { key: 'vehicle', label: 'Vehicle', render: (row) => (row.vehicle ? vehicleLabel(row.vehicle) : '—') },
            { key: 'method', label: 'Method', render: (row) => formatEnum(row.method) },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
            { key: 'amount', label: 'Received', align: 'right', render: (row) => <Amount cents={row.amountCents} /> },
            { key: 'remaining', label: 'Held', align: 'right', render: (row) => <Amount cents={row.remainingCents} strong /> },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (row) =>
                row.remainingCents > 0 && can('accounting.post_sales') && can('accounting.reverse') ? (
                  <Button size="sm" variant="ghost" onClick={() => setRefunding(row)}>Refund</Button>
                ) : null,
            },
          ]}
        />
      </Section>

      <Section
        title="Trade-ins"
        actions={
          <Can permission="accounting.sales">
            <Button variant="outline" onClick={() => setAppraising(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Appraise a trade-in
            </Button>
          </Can>
        }
      >
        <ErrorAlert error={withdraw.error} className="mb-2" />
        <DataTable
          loading={tradeIns.isPending}
          error={tradeIns.error}
          rows={tradeIns.data}
          rowKey={(row) => row.id}
          columns={[
            { key: 'vehicle', label: 'Vehicle', render: (row) => `${row.year} ${row.make} ${row.model}` },
            { key: 'customer', label: 'Customer', render: (row) => row.customer.name },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status === 'DRAFT' ? 'APPRAISED' : row.status === 'POSTED' ? 'ACQUIRED' : 'WITHDRAWN'} /> },
            { key: 'sale', label: 'Deal', render: (row) => (row.sale ? <Link href={`/dealer/accounting/sales/${row.sale.id}`} className="text-primary hover:underline">#{row.sale.number}</Link> : '—') },
            { key: 'acv', label: 'Actual cash value', align: 'right', render: (row) => <Amount cents={row.appraisedValueCents} /> },
            { key: 'allowance', label: 'Allowance', align: 'right', render: (row) => <Amount cents={row.tradeAllowanceCents} /> },
            { key: 'payoff', label: 'Lien payoff', align: 'right', render: (row) => <Amount cents={row.lienPayoffCents} /> },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (row) =>
                row.status === 'DRAFT' && can('accounting.sales') ? (
                  <Button size="sm" variant="ghost" loading={withdraw.isPending && withdraw.variables === row.id} onClick={() => withdraw.mutate(row.id)}>Withdraw</Button>
                ) : null,
            },
          ]}
        />
      </Section>

      {taking ? <DepositDialog onClose={() => setTaking(false)} /> : null}
      {refunding ? <RefundDialog deposit={refunding} onClose={() => setRefunding(null)} /> : null}
      {appraising ? <TradeInDialog onClose={() => setAppraising(false)} /> : null}
    </>
  );
}

function DepositDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ customerId: '', vehicleId: '', date: todayIso(), amount: '', method: 'DEBIT', bankAccountId: '', reference: '' });
  const save = useAcctMutation(() => acct.post('/deposits', { ...form, vehicleId: form.vehicleId || null, reference: form.reference || null }), onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Take a deposit"
      description="Card payments: record only the method and a receipt reference — never a card number."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!form.customerId || !form.amount || !form.bankAccountId} onClick={() => save.mutate(undefined)}>Record deposit</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer" htmlFor="dep-customer" className="sm:col-span-2">
          <CustomerSelect id="dep-customer" value={form.customerId} onChange={(id) => setForm({ ...form, customerId: id })} />
        </Field>
        <Field label="For vehicle (optional)" htmlFor="dep-vehicle" className="sm:col-span-2">
          <VehicleSelect id="dep-vehicle" value={form.vehicleId} onChange={(id) => setForm({ ...form, vehicleId: id })} placeholder="Not tied to a vehicle" />
        </Field>
        <Field label="Date" htmlFor="dep-date">
          <Input id="dep-date" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </Field>
        <Field label="Amount" htmlFor="dep-amount" error={fieldError(save.error, 'amount')}>
          <MoneyInput id="dep-amount" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
        </Field>
        <Field label="Method" htmlFor="dep-method">
          <Select id="dep-method" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>{PAYMENT_METHOD_LABELS[method]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Deposited to" htmlFor="dep-bank">
          <BankSelect id="dep-bank" value={form.bankAccountId} onChange={(id) => setForm({ ...form, bankAccountId: id })} />
        </Field>
        <Field label="Receipt reference" htmlFor="dep-ref" className="sm:col-span-2" error={fieldError(save.error, 'reference')}>
          <Input id="dep-ref" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function RefundDialog({ deposit, onClose }: { deposit: Deposit; onClose: () => void }) {
  const [form, setForm] = useState({ amount: centsInput(deposit.remainingCents), date: todayIso(), bankAccountId: '', reason: '' });
  const save = useAcctMutation(() => acct.post(`/deposits/${deposit.id}/refund`, form), onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Refund deposit #${deposit.number}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" loading={save.isPending} disabled={!form.bankAccountId || !form.reason.trim()} onClick={() => save.mutate(undefined)}>Refund</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Amount" htmlFor="ref-amount">
          <MoneyInput id="ref-amount" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
        </Field>
        <Field label="Date" htmlFor="ref-date">
          <Input id="ref-date" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </Field>
        <Field label="Paid from" htmlFor="ref-bank">
          <BankSelect id="ref-bank" value={form.bankAccountId} onChange={(id) => setForm({ ...form, bankAccountId: id })} />
        </Field>
        <Field label="Reason" htmlFor="ref-reason">
          <Textarea id="ref-reason" className="min-h-[70px]" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function TradeInDialog({ onClose }: { onClose: () => void }) {
  const { can } = useAccounting();
  const [form, setForm] = useState({
    customerId: '',
    vin: '',
    year: String(new Date().getFullYear() - 5),
    make: '',
    model: '',
    trim: '',
    mileageKm: '',
    bodyType: 'SEDAN',
    drivetrain: 'FWD',
    condition: 'USED',
    appraisedValue: '',
    tradeAllowance: '',
    lienPayoff: '',
    lienHolderVendorId: '',
    notes: '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((previous) => ({ ...previous, [key]: value }));
  const save = useAcctMutation(
    () =>
      acct.post('/trade-ins', {
        ...form,
        vin: form.vin || null,
        trim: form.trim || null,
        mileageKm: Number(form.mileageKm || 0),
        lienHolderVendorId: form.lienHolderVendorId || null,
        notes: form.notes || null,
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Appraise a trade-in"
      description="The actual cash value is what the vehicle is worth to you; anything allowed above it reduces the sale's revenue, not the trade's cost."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!form.customerId || !form.make || !form.model || !form.tradeAllowance} onClick={() => save.mutate(undefined)}>Save appraisal</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Customer" htmlFor="ti-customer" className="sm:col-span-3">
          <CustomerSelect id="ti-customer" value={form.customerId} onChange={set('customerId')} />
        </Field>
        <Field label="VIN" htmlFor="ti-vin" error={fieldError(save.error, 'vin')}>
          <Input id="ti-vin" maxLength={17} value={form.vin} onChange={(event) => set('vin')(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Year" htmlFor="ti-year" error={fieldError(save.error, 'year')}>
          <Input id="ti-year" type="number" value={form.year} onChange={(event) => set('year')(event.target.value)} />
        </Field>
        <Field label="Kilometres" htmlFor="ti-km">
          <Input id="ti-km" type="number" min={0} value={form.mileageKm} onChange={(event) => set('mileageKm')(event.target.value)} />
        </Field>
        <Field label="Make" htmlFor="ti-make">
          <Input id="ti-make" value={form.make} onChange={(event) => set('make')(event.target.value)} />
        </Field>
        <Field label="Model" htmlFor="ti-model">
          <Input id="ti-model" value={form.model} onChange={(event) => set('model')(event.target.value)} />
        </Field>
        <Field label="Trim" htmlFor="ti-trim">
          <Input id="ti-trim" value={form.trim} onChange={(event) => set('trim')(event.target.value)} />
        </Field>
        <Field label="Body" htmlFor="ti-body">
          <Select id="ti-body" value={form.bodyType} onChange={(event) => set('bodyType')(event.target.value)}>
            {BODY_TYPES.map((type) => <option key={type} value={type}>{formatEnum(type)}</option>)}
          </Select>
        </Field>
        <Field label="Drivetrain" htmlFor="ti-drive">
          <Select id="ti-drive" value={form.drivetrain} onChange={(event) => set('drivetrain')(event.target.value)}>
            {DRIVETRAINS.map((type) => <option key={type} value={type}>{type}</option>)}
          </Select>
        </Field>
        <Field label="Condition" htmlFor="ti-condition">
          <Select id="ti-condition" value={form.condition} onChange={(event) => set('condition')(event.target.value)}>
            {VEHICLE_CONDITIONS.map((type) => <option key={type} value={type}>{formatEnum(type)}</option>)}
          </Select>
        </Field>
        <Field label="Actual cash value" htmlFor="ti-acv" hint="Your appraisal.">
          <MoneyInput id="ti-acv" value={form.appraisedValue} onChange={set('appraisedValue')} />
        </Field>
        <Field label="Trade allowance" htmlFor="ti-allowance" hint="What the customer is credited.">
          <MoneyInput id="ti-allowance" value={form.tradeAllowance} onChange={set('tradeAllowance')} />
        </Field>
        <Field label="Lien payoff" htmlFor="ti-payoff" error={fieldError(save.error, 'lienHolderVendorId')}>
          <MoneyInput id="ti-payoff" value={form.lienPayoff} onChange={set('lienPayoff')} />
        </Field>
        {can('accounting.view') ? (
          <Field label="Lien holder" htmlFor="ti-lien" className="sm:col-span-3">
            <VendorSelect id="ti-lien" kind="LENDER" value={form.lienHolderVendorId} onChange={set('lienHolderVendorId')} placeholder="No lien" />
          </Field>
        ) : null}
        <Field label="Notes" htmlFor="ti-notes" className="sm:col-span-3">
          <Textarea id="ti-notes" className="min-h-[70px]" value={form.notes} onChange={(event) => set('notes')(event.target.value)} />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}
