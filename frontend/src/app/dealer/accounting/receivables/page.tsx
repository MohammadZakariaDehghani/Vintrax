'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS, parseMoneyToCents } from '@vintrax/shared';
import { Button, Dialog, ErrorAlert, Field, Input, Select } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { AgingSummary } from '@/components/accounting/aging';
import { PaymentDialog } from '@/components/accounting/payment-dialog';
import { CustomerSelect } from '@/components/accounting/pickers';
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
import { acct, isoDate, money, qs, todayIso } from '@/lib/accounting';

interface Invoice {
  id: string;
  number: string;
  customer: { id: string; name: string };
  saleId: string | null;
  date: string;
  dueDate: string;
  description: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: string;
  journalEntryId: string | null;
}

function Receivables() {
  const params = useSearchParams();
  const focus = params?.get('invoice');
  const { can } = useAccounting();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Invoice | 'new' | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const list = useAcctQuery<Invoice[]>(['invoices', status, q], `/invoices${qs({ status, q })}`);
  const rows = (list.data ?? []).filter((row) => !focus || row.id === focus);

  return (
    <>
      <PageHeader
        title="Accounts receivable"
        description="What customers owe: balances due on deals, and other invoices."
        actions={
          <>
            <Can permission="accounting.post">
              <Button variant="outline" onClick={() => setReceiving('new')}>Receive a payment</Button>
            </Can>
            <Can permission="accounting.post">
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden /> New invoice
              </Button>
            </Can>
          </>
        }
      />
      <AgingSummary kind="ar" />
      <Section title="Invoices">
        <div className="mb-3 flex flex-wrap gap-2">
          <Select aria-label="Status" className="h-9 w-40" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All invoices</option>
            <option value="OPEN">Open</option>
            <option value="PARTIAL">Part paid</option>
            <option value="PAID">Paid</option>
            <option value="VOID">Void</option>
          </Select>
          <Input type="search" aria-label="Invoice number" placeholder="Invoice number" className="h-9 w-48" value={q} onChange={(event) => setQ(event.target.value)} />
          {focus ? <Link href="/dealer/accounting/receivables" className="self-center text-sm text-primary hover:underline">Show all</Link> : null}
        </div>
        <DataTable
          loading={list.isPending}
          error={list.error}
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'number', label: 'Invoice', render: (row) => <span className="font-medium">{row.number}</span> },
            { key: 'customer', label: 'Customer', render: (row) => <Link href={`/dealer/accounting/customers/${row.customer.id}`} className="hover:text-primary">{row.customer.name}</Link> },
            { key: 'date', label: 'Date', render: (row) => isoDate(row.date) },
            { key: 'due', label: 'Due', render: (row) => isoDate(row.dueDate) },
            { key: 'for', label: 'For', render: (row) => (row.saleId ? <Link href={`/dealer/accounting/sales/${row.saleId}`} className="text-primary hover:underline">Vehicle sale</Link> : row.description ?? '—') },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
            { key: 'total', label: 'Total', align: 'right', render: (row) => <Amount cents={row.totalCents} /> },
            { key: 'balance', label: 'Balance', align: 'right', render: (row) => <Amount cents={row.balanceCents} strong /> },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (row) => (
                <span className="flex justify-end gap-1">
                  {row.journalEntryId ? <Link href={`/dealer/accounting/journal/${row.journalEntryId}`}><Button size="sm" variant="ghost">Entry</Button></Link> : null}
                  {row.balanceCents > 0 && can('accounting.post') ? <Button size="sm" variant="ghost" onClick={() => setReceiving(row)}>Receive</Button> : null}
                  {row.status === 'OPEN' && !row.saleId && can('accounting.reverse') ? <Button size="sm" variant="ghost" onClick={() => setVoiding(row)}>Void</Button> : null}
                </span>
              ),
            },
          ]}
        />
      </Section>
      {creating ? <InvoiceDialog onClose={() => setCreating(false)} /> : null}
      {receiving ? (
        <PaymentDialog
          direction="RECEIVED"
          partyId={receiving === 'new' ? '' : receiving.customer.id}
          documentId={receiving === 'new' ? undefined : receiving.id}
          onClose={() => setReceiving(null)}
        />
      ) : null}
      <ReasonDialog
        open={Boolean(voiding)}
        title={`Void invoice ${voiding?.number ?? ''}`}
        description="Reverses the invoice's entry. An invoice with payments applied cannot be voided; reverse the payments first."
        confirmLabel="Void invoice"
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => acct.post(`/invoices/${voiding!.id}/void`, { reason })}
      />
    </>
  );
}

interface Line {
  accountId: string;
  description: string;
  amount: string;
  taxCategory: string;
}

function InvoiceDialog({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts();
  const [form, setForm] = useState({ customerId: '', date: todayIso(), dueDate: todayIso(), description: '' });
  const [lines, setLines] = useState<Line[]>([{ accountId: '', description: '', amount: '', taxCategory: 'GENERAL' }]);
  const subtotal = lines.reduce((sum, line) => sum + (parseMoneyToCents(line.amount || '0') ?? 0), 0);
  const save = useAcctMutation(() => acct.post('/invoices', { ...form, description: form.description || null, lines }), onClose);
  const setLine = (index: number, patch: Partial<Line>) => setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="New invoice"
      description="Sales tax is added from your province's rules for each line's category."
      footer={
        <>
          <span className="mr-auto self-center text-sm">Subtotal {money(subtotal)} before tax</span>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!form.customerId || subtotal <= 0 || lines.some((line) => !line.accountId || !line.description)} onClick={() => save.mutate(undefined)}>Post invoice</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Customer" htmlFor="inv-customer" className="sm:col-span-2">
          <CustomerSelect id="inv-customer" value={form.customerId} onChange={(id) => setForm({ ...form, customerId: id })} />
        </Field>
        <Field label="Date" htmlFor="inv-date">
          <Input id="inv-date" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </Field>
        <Field label="Due" htmlFor="inv-due" error={fieldError(save.error, 'dueDate')}>
          <Input id="inv-due" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
        </Field>
        <Field label="Description" htmlFor="inv-description" className="sm:col-span-4">
          <Input id="inv-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1.6fr_1fr_8rem_auto]">
            <Select aria-label="Revenue account" value={line.accountId} onChange={(event) => setLine(index, { accountId: event.target.value })}>
              <option value="">Revenue account</option>
              <AccountOptions accounts={accounts.data} filter={(account) => account.type === 'REVENUE'} />
            </Select>
            <Input aria-label="Line description" placeholder="Description" value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} />
            <Select aria-label="Tax category" value={line.taxCategory} onChange={(event) => setLine(index, { taxCategory: event.target.value })}>
              {TAX_CATEGORIES.map((category) => <option key={category} value={category}>{TAX_CATEGORY_LABELS[category]}</option>)}
            </Select>
            <MoneyInput id={`inv-amount-${index}`} aria-label="Amount" value={line.amount} onChange={(value) => setLine(index, { amount: value })} />
            <Button size="icon" variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setLines([...lines, { accountId: '', description: '', amount: '', taxCategory: 'GENERAL' }])}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
        </Button>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

export default function ReceivablesPage() {
  return (
    <Suspense>
      <Receivables />
    </Suspense>
  );
}
