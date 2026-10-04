'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  VEHICLE_COST_CATEGORIES,
  VEHICLE_COST_CATEGORY_LABELS,
  parseMoneyToCents,
} from '@vintrax/shared';
import { Badge, Button, Dialog, ErrorAlert, Field, Input, Select } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { AgingSummary } from '@/components/accounting/aging';
import { PaymentDialog } from '@/components/accounting/payment-dialog';
import { VehicleSelect, VendorSelect } from '@/components/accounting/pickers';
import {
  AccountOptions,
  Amount,
  Can,
  DataTable,
  MoneyInput,
  PageHeader,
  ReasonDialog,
  Section,
  StatusBadge,
  fieldError,
  useAccounts,
  useAcctMutation,
  useAcctQuery,
} from '@/components/accounting/ui';
import { acct, addDaysIso, centsInput, isoDate, money, qs, todayIso } from '@/lib/accounting';

interface Bill {
  id: string;
  number: number;
  kind: 'BILL' | 'CREDIT_NOTE';
  vendor: { id: string; name: string };
  vendorReference: string | null;
  date: string;
  dueDate: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: string;
  daysUntilDue: number | null;
  journalEntryId: string | null;
}

function Payables() {
  const params = useSearchParams();
  const focus = params?.get('bill');
  const { can } = useAccounting();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState(params?.get('q') ?? '');
  const [creating, setCreating] = useState<'BILL' | 'CREDIT_NOTE' | null>(null);
  const [paying, setPaying] = useState<Bill | 'new' | null>(null);
  const [voiding, setVoiding] = useState<Bill | null>(null);
  const [applying, setApplying] = useState<Bill | null>(null);
  const list = useAcctQuery<Bill[]>(['bills', status, q], `/bills${qs({ status, q })}`);
  const rows = (list.data ?? []).filter((row) => !focus || row.id === focus);

  return (
    <>
      <PageHeader
        title="Accounts payable"
        description="Vendor bills and credit notes. Recoverable GST/HST goes to input tax credits; PST you pay is part of the cost."
        actions={
          <Can permission="accounting.post">
            <Button variant="outline" onClick={() => setPaying('new')}>
              Pay a vendor
            </Button>
            <Button variant="outline" onClick={() => setCreating('CREDIT_NOTE')}>
              Credit note
            </Button>
            <Button onClick={() => setCreating('BILL')}>
              <Plus className="h-4 w-4" aria-hidden /> Enter a bill
            </Button>
          </Can>
        }
      />
      <AgingSummary kind="ap" />
      <Section title="Bills">
        <div className="mb-3 flex flex-wrap gap-2">
          <Select
            aria-label="Status"
            className="h-9 w-40"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All bills</option>
            <option value="OPEN">Open</option>
            <option value="PARTIAL">Part paid</option>
            <option value="PAID">Paid</option>
            <option value="VOID">Void</option>
          </Select>
          <Input
            type="search"
            aria-label="Vendor reference"
            placeholder="Vendor invoice #"
            className="h-9 w-48"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          {focus ? (
            <Link
              href="/dealer/accounting/payables"
              className="self-center text-sm text-primary hover:underline"
            >
              Show all
            </Link>
          ) : null}
        </div>
        <DataTable
          loading={list.isPending}
          error={list.error}
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'number',
              label: 'Bill',
              render: (row) => (
                <span className="font-medium">
                  #{row.number}
                  {row.kind === 'CREDIT_NOTE' ? (
                    <Badge variant="accent" className="ml-2">
                      Credit
                    </Badge>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'vendor',
              label: 'Vendor',
              render: (row) => (
                <Link
                  href={`/dealer/accounting/vendors/${row.vendor.id}`}
                  className="hover:text-primary"
                >
                  {row.vendor.name}
                </Link>
              ),
            },
            { key: 'ref', label: 'Their #', render: (row) => row.vendorReference ?? '—' },
            { key: 'date', label: 'Date', render: (row) => isoDate(row.date) },
            {
              key: 'due',
              label: 'Due',
              render: (row) => (
                <span
                  className={
                    row.daysUntilDue !== null && row.daysUntilDue < 0
                      ? 'font-medium text-destructive'
                      : undefined
                  }
                >
                  {isoDate(row.dueDate)}
                </span>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: (row) => <StatusBadge status={row.status} />,
            },
            {
              key: 'total',
              label: 'Total',
              align: 'right',
              render: (row) => <Amount cents={row.totalCents} />,
            },
            {
              key: 'balance',
              label: 'Balance',
              align: 'right',
              render: (row) => <Amount cents={row.balanceCents} strong />,
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
                  {row.kind === 'BILL' && row.balanceCents > 0 && can('accounting.post') ? (
                    <Button size="sm" variant="ghost" onClick={() => setPaying(row)}>
                      Pay
                    </Button>
                  ) : null}
                  {row.kind === 'CREDIT_NOTE' && row.balanceCents > 0 && can('accounting.post') ? (
                    <Button size="sm" variant="ghost" onClick={() => setApplying(row)}>
                      Apply
                    </Button>
                  ) : null}
                  {row.status === 'OPEN' && can('accounting.reverse') ? (
                    <Button size="sm" variant="ghost" onClick={() => setVoiding(row)}>
                      Void
                    </Button>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </Section>
      {creating ? <BillDialog kind={creating} onClose={() => setCreating(null)} /> : null}
      {paying ? (
        <PaymentDialog
          direction="SENT"
          partyId={paying === 'new' ? '' : paying.vendor.id}
          documentId={paying === 'new' ? undefined : paying.id}
          onClose={() => setPaying(null)}
        />
      ) : null}
      {applying ? (
        <ApplyCreditDialog
          credit={applying}
          bills={list.data ?? []}
          onClose={() => setApplying(null)}
        />
      ) : null}
      <ReasonDialog
        open={Boolean(voiding)}
        title={`Void bill #${voiding?.number ?? ''}`}
        description="Reverses the bill's entry. A bill with payments applied cannot be voided."
        confirmLabel="Void bill"
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => acct.post(`/bills/${voiding!.id}/void`, { reason })}
      />
    </>
  );
}

interface Line {
  accountId: string;
  description: string;
  amount: string;
  vehicleId: string;
  costCategory: string;
}

const emptyLine = (): Line => ({
  accountId: '',
  description: '',
  amount: '',
  vehicleId: '',
  costCategory: '',
});

function BillDialog({ kind, onClose }: { kind: 'BILL' | 'CREDIT_NOTE'; onClose: () => void }) {
  const accounts = useAccounts();
  const inventoryId = accounts.data?.find(
    (account) => account.systemKey === 'VEHICLE_INVENTORY',
  )?.id;
  const [form, setForm] = useState({
    vendorId: '',
    vendorReference: '',
    date: todayIso(),
    dueDate: addDaysIso(todayIso(), 30),
    vendorChargedTax: true,
  });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const subtotal = lines.reduce(
    (sum, line) => sum + (parseMoneyToCents(line.amount || '0') ?? 0),
    0,
  );
  const save = useAcctMutation(
    () =>
      acct.post('/bills', {
        ...form,
        kind,
        vendorReference: form.vendorReference || null,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          description: line.description,
          amount: line.amount,
          vehicleId: line.vehicleId || null,
          costCategory: line.costCategory || null,
        })),
      }),
    onClose,
  );
  const setLine = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={kind === 'BILL' ? 'Enter a vendor bill' : 'Enter a vendor credit note'}
      description="A line to Vehicle Inventory with a vehicle adds to that vehicle's cost (reconditioning, transport and the like)."
      footer={
        <>
          <span className="mr-auto self-center text-sm">Subtotal {money(subtotal)} before tax</span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={
              !form.vendorId ||
              subtotal <= 0 ||
              lines.some((line) => !line.accountId || !line.description)
            }
            onClick={() => save.mutate(undefined)}
          >
            Post
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Vendor" htmlFor="bill-vendor" className="sm:col-span-2">
          <VendorSelect
            id="bill-vendor"
            value={form.vendorId}
            onChange={(id) => setForm({ ...form, vendorId: id })}
          />
        </Field>
        <Field label="Their invoice #" htmlFor="bill-ref">
          <Input
            id="bill-ref"
            value={form.vendorReference}
            onChange={(event) => setForm({ ...form, vendorReference: event.target.value })}
          />
        </Field>
        <Field label="Date" htmlFor="bill-date">
          <Input
            id="bill-date"
            type="date"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
          />
        </Field>
        <Field label="Due" htmlFor="bill-due" error={fieldError(save.error, 'dueDate')}>
          <Input
            id="bill-due"
            type="date"
            value={form.dueDate}
            onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-3">
          <input
            type="checkbox"
            checked={form.vendorChargedTax}
            onChange={(event) => setForm({ ...form, vendorChargedTax: event.target.checked })}
          />
          The vendor charged sales tax on this bill
        </label>
      </div>
      <div className="mt-4 space-y-3">
        {lines.map((line, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1.3fr_1.5fr_8rem_auto]"
          >
            <Select
              aria-label="Account"
              value={line.accountId}
              onChange={(event) => setLine(index, { accountId: event.target.value })}
            >
              <option value="">Account</option>
              <AccountOptions
                accounts={accounts.data}
                filter={(account) =>
                  account.type === 'EXPENSE' || account.type === 'COGS' || account.type === 'ASSET'
                }
              />
            </Select>
            <Input
              aria-label="Description"
              placeholder="Description"
              value={line.description}
              onChange={(event) => setLine(index, { description: event.target.value })}
            />
            <MoneyInput
              id={`bill-amount-${index}`}
              aria-label="Amount"
              value={line.amount}
              onChange={(value) => setLine(index, { amount: value })}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove line"
              disabled={lines.length === 1}
              onClick={() => setLines(lines.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
            {line.accountId && line.accountId === inventoryId ? (
              <div className="grid gap-2 sm:col-span-4 sm:grid-cols-[2fr_1fr]">
                <VehicleSelect
                  id={`bill-vehicle-${index}`}
                  value={line.vehicleId}
                  onChange={(id) => setLine(index, { vehicleId: id })}
                />
                <Select
                  aria-label="Cost category"
                  value={line.costCategory}
                  onChange={(event) => setLine(index, { costCategory: event.target.value })}
                >
                  <option value="">Cost category</option>
                  {VEHICLE_COST_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {VEHICLE_COST_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setLines([...lines, emptyLine()])}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
        </Button>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function ApplyCreditDialog({
  credit,
  bills,
  onClose,
}: {
  credit: Bill;
  bills: Bill[];
  onClose: () => void;
}) {
  const open = bills.filter(
    (bill) => bill.kind === 'BILL' && bill.vendor.id === credit.vendor.id && bill.balanceCents > 0,
  );
  const [billId, setBillId] = useState(open[0]?.id ?? '');
  const [amount, setAmount] = useState(centsInput(credit.balanceCents));
  const save = useAcctMutation(
    () => acct.post(`/bills/${credit.id}/apply`, { billId, amount }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Apply credit note #${credit.number}`}
      description={`${money(credit.balanceCents)} unused from ${credit.vendor.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!billId}
            onClick={() => save.mutate(undefined)}
          >
            Apply
          </Button>
        </>
      }
    >
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This vendor has no open bills to apply it to.
        </p>
      ) : (
        <div className="grid gap-3">
          <Field label="Bill" htmlFor="apply-bill">
            <Select
              id="apply-bill"
              value={billId}
              onChange={(event) => setBillId(event.target.value)}
            >
              {open.map((bill) => (
                <option key={bill.id} value={bill.id}>
                  #{bill.number} · {money(bill.balanceCents)} open
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="apply-amount">
            <MoneyInput id="apply-amount" value={amount} onChange={setAmount} />
          </Field>
        </div>
      )}
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

export default function PayablesPage() {
  return (
    <Suspense>
      <Payables />
    </Suspense>
  );
}
