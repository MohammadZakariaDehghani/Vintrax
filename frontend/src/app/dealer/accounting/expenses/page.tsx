'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  EXPENSE_TREATMENTS,
  EXPENSE_TREATMENT_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  RECURRENCE_FREQUENCIES,
  TAX_CATEGORIES,
  TAX_CATEGORY_LABELS,
  VEHICLE_COST_CATEGORIES,
  VEHICLE_COST_CATEGORY_LABELS,
  parseMoneyToCents,
  type ExpenseTreatment,
} from '@vintrax/shared';
import { Badge, Button, Dialog, ErrorAlert, Field, Input, Select } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { BankSelect, VehicleSelect, VendorSelect } from '@/components/accounting/pickers';
import {
  AccountOptions,
  Amount,
  Can,
  DataTable,
  ExportButtons,
  MoneyInput,
  PageHeader,
  RangeFilter,
  ReasonDialog,
  Section,
  StatusBadge,
  fieldError,
  useAccounts,
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
import { formatEnum } from '@/lib/utils';

interface Expense {
  id: string;
  number: number;
  date: string;
  vendor: { id: string; name: string } | null;
  account: { id: string; code: string; name: string };
  treatment: ExpenseTreatment;
  vehicle: { id: string; vin: string | null; year: number; make: string; model: string } | null;
  description: string;
  amountCents: number;
  taxCents: number;
  totalCents: number;
  status: string;
  recurring: boolean;
  journalEntryId: string | null;
}

interface Recurring {
  id: string;
  description: string;
  account: { id: string; code: string; name: string };
  amountCents: number;
  frequency: string;
  nextDate: string;
  endDate: string | null;
  isActive: boolean;
  due: boolean;
  bankAccount: { id: string; name: string };
}

function Expenses() {
  const params = useSearchParams();
  const focus = params?.get('expense');
  const { can } = useAccounting();
  const [range, setRange] = useState<RangeState>(DEFAULT_RANGE);
  const [treatment, setTreatment] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingRecurring, setCreatingRecurring] = useState(false);
  const [reversing, setReversing] = useState<Expense | null>(null);
  const filters = rangeParams(range);
  const list = useAcctQuery<{ items: Expense[]; totalCents: number }>(
    ['expenses', filters],
    `/expenses${qs(filters)}`,
  );
  const recurring = useAcctQuery<Recurring[]>(['recurring'], '/recurring-expenses');
  const postDue = useAcctMutation(() =>
    acct.post<{ posted: number }>('/recurring-expenses/post-due'),
  );
  const toggle = useAcctMutation((row: Recurring) =>
    acct.patch(`/recurring-expenses/${row.id}`, { isActive: !row.isActive }),
  );
  const rows = (list.data?.items ?? []).filter(
    (row) => (!focus || row.id === focus) && (!treatment || row.treatment === treatment),
  );
  const dueCount = (recurring.data ?? []).filter((row) => row.due).length;

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Day-to-day costs. A vehicle's direct cost (detailing, repairs, transport) is added to that vehicle's inventory value instead of expensed."
        actions={
          <Can permission="accounting.post">
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Record an expense
            </Button>
          </Can>
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <RangeFilter value={range} onChange={setRange} />
          <Select
            aria-label="Treatment"
            className="h-9 w-56"
            value={treatment}
            onChange={(event) => setTreatment(event.target.value)}
          >
            <option value="">Every kind</option>
            {EXPENSE_TREATMENTS.map((entry) => (
              <option key={entry} value={entry}>
                {EXPENSE_TREATMENT_LABELS[entry]}
              </option>
            ))}
          </Select>
          {focus ? (
            <Link
              href="/dealer/accounting/expenses"
              className="self-center text-sm text-primary hover:underline"
            >
              Show all
            </Link>
          ) : null}
        </div>
        <ExportButtons report="expenses" params={filters} />
      </div>
      {list.data ? (
        <p className="mb-2 text-sm">
          Posted in this period: <Amount cents={list.data.totalCents} strong />
        </p>
      ) : null}
      <DataTable
        loading={list.isPending}
        error={list.error}
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { key: 'date', label: 'Date', render: (row) => isoDate(row.date) },
          {
            key: 'description',
            label: 'Description',
            render: (row) => (
              <>
                {row.description}
                {row.recurring ? (
                  <Badge variant="outline" className="ml-2">
                    Recurring
                  </Badge>
                ) : null}
              </>
            ),
          },
          { key: 'vendor', label: 'Vendor', render: (row) => row.vendor?.name ?? '—' },
          {
            key: 'account',
            label: 'Account',
            render: (row) => `${row.account.code} ${row.account.name}`,
          },
          {
            key: 'treatment',
            label: 'Kind',
            render: (row) => (row.vehicle ? vehicleLabel(row.vehicle) : formatEnum(row.treatment)),
          },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          {
            key: 'tax',
            label: 'Tax',
            align: 'right',
            render: (row) => <Amount cents={row.taxCents} />,
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
                  <Button size="sm" variant="ghost" onClick={() => setReversing(row)}>
                    Reverse
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />

      <Section
        className="mt-8"
        title="Recurring expenses"
        description="Rent, software, insurance. They post when you choose — nothing posts on its own."
        actions={
          <>
            {dueCount > 0 && can('accounting.post') ? (
              <Button
                variant="secondary"
                loading={postDue.isPending}
                onClick={() => postDue.mutate(undefined)}
              >
                Post {dueCount} due now
              </Button>
            ) : null}
            <Can permission="accounting.create">
              <Button variant="outline" onClick={() => setCreatingRecurring(true)}>
                <Plus className="h-4 w-4" aria-hidden /> Add recurring
              </Button>
            </Can>
          </>
        }
      >
        <ErrorAlert error={postDue.error ?? toggle.error} className="mb-2" />
        <DataTable
          dense
          loading={recurring.isPending}
          error={recurring.error}
          rows={recurring.data}
          rowKey={(row) => row.id}
          columns={[
            { key: 'description', label: 'Description', render: (row) => row.description },
            {
              key: 'account',
              label: 'Account',
              render: (row) => `${row.account.code} ${row.account.name}`,
            },
            { key: 'frequency', label: 'Every', render: (row) => formatEnum(row.frequency) },
            {
              key: 'next',
              label: 'Next',
              render: (row) => (
                <span className={row.due ? 'font-medium text-warning' : undefined}>
                  {isoDate(row.nextDate)}
                  {row.due ? ' · due' : ''}
                </span>
              ),
            },
            {
              key: 'amount',
              label: 'Amount',
              align: 'right',
              render: (row) => <Amount cents={row.amountCents} />,
            },
            {
              key: 'active',
              label: '',
              align: 'right',
              render: (row) =>
                can('accounting.edit') ? (
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(row)}>
                    {row.isActive ? 'Pause' : 'Resume'}
                  </Button>
                ) : row.isActive ? (
                  'Active'
                ) : (
                  'Paused'
                ),
            },
          ]}
        />
      </Section>

      {creating ? <ExpenseDialog onClose={() => setCreating(false)} /> : null}
      {creatingRecurring ? <RecurringDialog onClose={() => setCreatingRecurring(false)} /> : null}
      <ReasonDialog
        open={Boolean(reversing)}
        title="Reverse this expense"
        description="Posts the opposite entry; the original stays in the books."
        confirmLabel="Reverse expense"
        onClose={() => setReversing(null)}
        onConfirm={(reason) => acct.post(`/expenses/${reversing!.id}/reverse`, { reason })}
      />
    </>
  );
}

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts();
  const [form, setForm] = useState({
    date: todayIso(),
    vendorId: '',
    accountId: '',
    treatment: 'OPERATING' as ExpenseTreatment,
    vehicleId: '',
    costCategory: 'DETAILING',
    description: '',
    amount: '',
    applyTax: true,
    taxCategory: 'GENERAL',
    method: 'DEBIT',
    bankAccountId: '',
    reference: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const vehicleCost = form.treatment === 'VEHICLE_COST';
  const save = useAcctMutation(
    () =>
      acct.post('/expenses', {
        ...form,
        vendorId: form.vendorId || null,
        vehicleId: form.vehicleId || null,
        costCategory: vehicleCost ? form.costCategory : null,
        reference: form.reference || null,
        accountId: form.accountId,
      }),
    onClose,
  );
  const accountFilter = (type: string) =>
    form.treatment === 'CAPITAL'
      ? type === 'ASSET'
      : form.treatment === 'COGS'
        ? type === 'COGS'
        : form.treatment === 'VEHICLE_COST'
          ? type === 'ASSET'
          : type === 'EXPENSE';
  const inventory = accounts.data?.find((account) => account.systemKey === 'VEHICLE_INVENTORY');
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Record an expense"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.accountId || !form.amount || !form.description || !form.bankAccountId}
            onClick={() => save.mutate(undefined)}
          >
            Post expense
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="How it is treated" htmlFor="ex-treatment" className="sm:col-span-3">
          <Select
            id="ex-treatment"
            value={form.treatment}
            onChange={(event) => {
              const treatment = event.target.value as ExpenseTreatment;
              setForm({
                ...form,
                treatment,
                accountId: treatment === 'VEHICLE_COST' ? (inventory?.id ?? '') : '',
              });
            }}
          >
            {EXPENSE_TREATMENTS.map((entry) => (
              <option key={entry} value={entry}>
                {EXPENSE_TREATMENT_LABELS[entry]}
              </option>
            ))}
          </Select>
        </Field>
        {vehicleCost ? (
          <>
            <Field
              label="Vehicle"
              htmlFor="ex-vehicle"
              className="sm:col-span-2"
              error={fieldError(save.error, 'vehicleId')}
            >
              <VehicleSelect
                id="ex-vehicle"
                value={form.vehicleId}
                onChange={(id) => set('vehicleId', id)}
              />
            </Field>
            <Field label="Cost category" htmlFor="ex-category">
              <Select
                id="ex-category"
                value={form.costCategory}
                onChange={(event) => set('costCategory', event.target.value)}
              >
                {VEHICLE_COST_CATEGORIES.filter((category) => category !== 'PURCHASE').map(
                  (category) => (
                    <option key={category} value={category}>
                      {VEHICLE_COST_CATEGORY_LABELS[category]}
                    </option>
                  ),
                )}
              </Select>
            </Field>
          </>
        ) : null}
        <Field label="Account" htmlFor="ex-account" className="sm:col-span-2">
          <Select
            id="ex-account"
            value={form.accountId}
            onChange={(event) => set('accountId', event.target.value)}
          >
            <option value="">Choose an account</option>
            <AccountOptions
              accounts={accounts.data}
              filter={(account) => accountFilter(account.type)}
            />
          </Select>
        </Field>
        <Field label="Date" htmlFor="ex-date">
          <Input
            id="ex-date"
            type="date"
            value={form.date}
            onChange={(event) => set('date', event.target.value)}
          />
        </Field>
        <Field label="Description" htmlFor="ex-description" className="sm:col-span-2">
          <Input
            id="ex-description"
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </Field>
        <Field label="Amount before tax" htmlFor="ex-amount">
          <MoneyInput
            id="ex-amount"
            value={form.amount}
            onChange={(value) => set('amount', value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={form.applyTax}
            onChange={(event) => set('applyTax', event.target.checked)}
          />
          Sales tax was charged (recoverable GST/HST/QST is claimed back)
        </label>
        <Field label="Tax category" htmlFor="ex-taxcat">
          <Select
            id="ex-taxcat"
            value={form.taxCategory}
            onChange={(event) => set('taxCategory', event.target.value)}
            disabled={!form.applyTax}
          >
            {TAX_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {TAX_CATEGORY_LABELS[category]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor" htmlFor="ex-vendor" className="sm:col-span-3">
          <VendorSelect
            id="ex-vendor"
            value={form.vendorId}
            onChange={(id) => set('vendorId', id)}
            placeholder="No vendor"
          />
        </Field>
        <Field label="Paid by" htmlFor="ex-method">
          <Select
            id="ex-method"
            value={form.method}
            onChange={(event) => set('method', event.target.value)}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From account" htmlFor="ex-bank">
          <BankSelect
            id="ex-bank"
            value={form.bankAccountId}
            onChange={(id) => set('bankAccountId', id)}
          />
        </Field>
        <Field
          label="Receipt reference"
          htmlFor="ex-ref"
          error={fieldError(save.error, 'reference')}
        >
          <Input
            id="ex-ref"
            value={form.reference}
            onChange={(event) => set('reference', event.target.value)}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function RecurringDialog({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts();
  const [form, setForm] = useState({
    description: '',
    vendorId: '',
    accountId: '',
    amount: '',
    applyTax: true,
    method: 'BANK_TRANSFER',
    bankAccountId: '',
    frequency: 'MONTHLY',
    nextDate: todayIso(),
    endDate: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const save = useAcctMutation(
    () =>
      acct.post('/recurring-expenses', {
        ...form,
        vendorId: form.vendorId || null,
        endDate: form.endDate || null,
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a recurring expense"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted-foreground">
            {form.amount
              ? `${money(parseMoneyToCents(form.amount) ?? 0)} ${form.frequency.toLowerCase()}`
              : ''}
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.description || !form.accountId || !form.amount || !form.bankAccountId}
            onClick={() => save.mutate(undefined)}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Description" htmlFor="re-description" className="sm:col-span-2">
          <Input
            id="re-description"
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </Field>
        <Field label="Account" htmlFor="re-account">
          <Select
            id="re-account"
            value={form.accountId}
            onChange={(event) => set('accountId', event.target.value)}
          >
            <option value="">Choose an account</option>
            <AccountOptions
              accounts={accounts.data}
              filter={(account) => account.type === 'EXPENSE'}
            />
          </Select>
        </Field>
        <Field label="Amount before tax" htmlFor="re-amount">
          <MoneyInput
            id="re-amount"
            value={form.amount}
            onChange={(value) => set('amount', value)}
          />
        </Field>
        <Field label="Every" htmlFor="re-frequency">
          <Select
            id="re-frequency"
            value={form.frequency}
            onChange={(event) => set('frequency', event.target.value)}
          >
            {RECURRENCE_FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {formatEnum(frequency)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next date" htmlFor="re-next">
          <Input
            id="re-next"
            type="date"
            value={form.nextDate}
            onChange={(event) => set('nextDate', event.target.value)}
          />
        </Field>
        <Field label="Paid from" htmlFor="re-bank">
          <BankSelect
            id="re-bank"
            value={form.bankAccountId}
            onChange={(id) => set('bankAccountId', id)}
          />
        </Field>
        <Field label="Ends (optional)" htmlFor="re-end">
          <Input
            id="re-end"
            type="date"
            value={form.endDate}
            onChange={(event) => set('endDate', event.target.value)}
          />
        </Field>
        <Field label="Vendor" htmlFor="re-vendor" className="sm:col-span-2">
          <VendorSelect
            id="re-vendor"
            value={form.vendorId}
            onChange={(id) => set('vendorId', id)}
            placeholder="No vendor"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={form.applyTax}
            onChange={(event) => set('applyTax', event.target.checked)}
          />
          Sales tax is charged
        </label>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

export default function ExpensesPage() {
  return (
    <Suspense>
      <Expenses />
    </Suspense>
  );
}
