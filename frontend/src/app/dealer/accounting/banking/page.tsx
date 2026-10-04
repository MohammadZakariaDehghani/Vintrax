'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  BANK_ACCOUNT_TYPES,
  BANK_ACCOUNT_TYPE_LABELS,
  BANK_TRANSACTION_KINDS,
  type BankAccountType,
} from '@vintrax/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  ErrorAlert,
  Field,
  Input,
  Select,
} from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { BankSelect } from '@/components/accounting/pickers';
import {
  AccountOptions,
  Amount,
  Can,
  DataTable,
  MoneyInput,
  PageHeader,
  RangeFilter,
  RangeLabel,
  Section,
  StatusBadge,
  fieldError,
  useAccounts,
  useAcctMutation,
  useAcctQuery,
} from '@/components/accounting/ui';
import {
  DEFAULT_RANGE,
  acct,
  isoDate,
  qs,
  rangeParams,
  todayIso,
  type Range,
  type RangeState,
} from '@/lib/accounting';
import { formatEnum } from '@/lib/utils';

interface BankAccount {
  id: string;
  name: string;
  bankName: string | null;
  type: BankAccountType;
  accountNumberMasked: string | null;
  glAccount: { id: string; code: string; name: string };
  balanceCents: number;
  isActive: boolean;
  lastReconciledDate: string | null;
  lastReconciledBalanceCents: number | null;
  unreconciledCount: number;
}

interface Register {
  range: Range;
  openingCents: number;
  items: Array<{
    lineId: string;
    date: string;
    reference: string;
    description: string;
    journalEntryId: string;
    depositCents: number;
    withdrawalCents: number;
    balanceCents: number;
    reconciled: boolean;
  }>;
}

interface Reconciliation {
  id: string;
  bankAccount: { id: string; name: string };
  statementDate: string;
  endingBalanceCents: number;
  clearedBalanceCents: number;
  differenceCents: number;
  status: string;
}

export default function BankingPage() {
  const { can } = useAccounting();
  const router = useRouter();
  const accounts = useAcctQuery<BankAccount[]>(['bank-accounts'], '/bank-accounts');
  const recs = useAcctQuery<Reconciliation[]>(['reconciliations'], '/reconciliations');
  const [selected, setSelected] = useState<string>('');
  const [range, setRange] = useState<RangeState>(DEFAULT_RANGE);
  const [adding, setAdding] = useState(false);
  const [transacting, setTransacting] = useState(false);
  const [reconciling, setReconciling] = useState<BankAccount | null>(null);
  const current = selected || accounts.data?.[0]?.id || '';
  const register = useAcctQuery<Register>(
    ['register', current, range],
    `/bank-accounts/${current}/register${qs(rangeParams(range))}`,
    Boolean(current),
  );

  return (
    <>
      <PageHeader
        title="Banking"
        description="Bank, cash and card accounts. Only the last four digits of an account number are ever stored."
        actions={
          <>
            <Can permission="accounting.post">
              <Button variant="outline" onClick={() => setTransacting(true)}>
                Record a transaction
              </Button>
            </Can>
            <Can permission="accounting.manage_accounts">
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" aria-hidden /> Add account
              </Button>
            </Can>
          </>
        }
      />
      <ErrorAlert error={accounts.error} />
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.data?.map((account) => (
          <Card key={account.id} className={account.id === current ? 'border-primary' : undefined}>
            <CardContent className="pt-5">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setSelected(account.id)}
              >
                <p className="flex items-center justify-between gap-2 font-semibold">
                  {account.name}
                  <Badge variant="outline">{BANK_ACCOUNT_TYPE_LABELS[account.type]}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {[account.bankName, account.accountNumberMasked, `GL ${account.glAccount.code}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-2 text-2xl font-bold">
                  <Amount cents={account.balanceCents} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {account.lastReconciledDate
                    ? `Reconciled to ${isoDate(account.lastReconciledDate)}`
                    : 'Never reconciled'}{' '}
                  · {account.unreconciledCount} uncleared
                </p>
              </button>
              {can('accounting.reconcile_bank') && account.isActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setReconciling(account)}
                >
                  Reconcile
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Section title="Reconciliations">
        <DataTable
          dense
          loading={recs.isPending}
          error={recs.error}
          rows={recs.data}
          rowKey={(row) => row.id}
          empty={
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No reconciliations yet.
            </p>
          }
          columns={[
            { key: 'account', label: 'Account', render: (row) => row.bankAccount.name },
            {
              key: 'date',
              label: 'Statement date',
              render: (row) => (
                <Link
                  href={`/dealer/accounting/banking/reconciliation/${row.id}`}
                  className="text-primary hover:underline"
                >
                  {isoDate(row.statementDate)}
                </Link>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: (row) => <StatusBadge status={row.status} />,
            },
            {
              key: 'statement',
              label: 'Statement',
              align: 'right',
              render: (row) => <Amount cents={row.endingBalanceCents} />,
            },
            {
              key: 'cleared',
              label: 'Cleared',
              align: 'right',
              render: (row) => <Amount cents={row.clearedBalanceCents} />,
            },
            {
              key: 'difference',
              label: 'Difference',
              align: 'right',
              render: (row) => <Amount cents={row.differenceCents} strong />,
            },
          ]}
        />
      </Section>

      <Section
        title="Register"
        actions={<RangeFilter value={range} onChange={setRange} />}
        description={register.data ? undefined : 'Choose an account above.'}
      >
        {register.data ? (
          <p className="mb-2 text-sm">
            <RangeLabel range={register.data.range} /> · Opening{' '}
            <Amount cents={register.data.openingCents} strong />
          </p>
        ) : null}
        <DataTable
          dense
          loading={register.isPending && Boolean(current)}
          error={register.error}
          rows={register.data?.items}
          rowKey={(row) => row.lineId}
          columns={[
            { key: 'date', label: 'Date', render: (row) => isoDate(row.date) },
            {
              key: 'ref',
              label: 'Entry',
              render: (row) => (
                <Link
                  href={`/dealer/accounting/journal/${row.journalEntryId}`}
                  className="text-primary hover:underline"
                >
                  {row.reference}
                </Link>
              ),
            },
            { key: 'description', label: 'Description', render: (row) => row.description },
            {
              key: 'cleared',
              label: '',
              render: (row) => (row.reconciled ? <Badge variant="success">Cleared</Badge> : null),
            },
            {
              key: 'in',
              label: 'Deposit',
              align: 'right',
              render: (row) => (row.depositCents ? <Amount cents={row.depositCents} /> : null),
            },
            {
              key: 'out',
              label: 'Withdrawal',
              align: 'right',
              render: (row) =>
                row.withdrawalCents ? <Amount cents={row.withdrawalCents} /> : null,
            },
            {
              key: 'balance',
              label: 'Balance',
              align: 'right',
              render: (row) => <Amount cents={row.balanceCents} strong />,
            },
          ]}
        />
      </Section>

      {adding ? <BankAccountDialog onClose={() => setAdding(false)} /> : null}
      {transacting ? <TransactionDialog onClose={() => setTransacting(false)} /> : null}
      {reconciling ? (
        <StartReconciliationDialog
          account={reconciling}
          onClose={() => setReconciling(null)}
          onStarted={(id) => router.push(`/dealer/accounting/banking/reconciliation/${id}`)}
        />
      ) : null}
    </>
  );
}

function BankAccountDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    name: '',
    bankName: '',
    type: 'CHEQUING' as BankAccountType,
    accountNumberLast4: '',
    openingBalance: '',
    openingDate: todayIso(),
  });
  const save = useAcctMutation(
    () =>
      acct.post('/bank-accounts', {
        ...form,
        bankName: form.bankName || null,
        openingBalance: form.openingBalance || '0',
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a bank, cash or card account"
      description="A ledger account is created for it. An opening balance is posted against owner's equity."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.name}
            onClick={() => save.mutate(undefined)}
          >
            Add account
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="ba-name">
          <Input
            id="ba-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="Type" htmlFor="ba-type">
          <Select
            id="ba-type"
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value as BankAccountType })}
          >
            {BANK_ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {BANK_ACCOUNT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bank" htmlFor="ba-bank">
          <Input
            id="ba-bank"
            value={form.bankName}
            onChange={(event) => setForm({ ...form, bankName: event.target.value })}
          />
        </Field>
        <Field
          label="Last 4 digits only"
          htmlFor="ba-last4"
          error={fieldError(save.error, 'accountNumberLast4')}
        >
          <Input
            id="ba-last4"
            inputMode="numeric"
            maxLength={4}
            value={form.accountNumberLast4}
            onChange={(event) =>
              setForm({ ...form, accountNumberLast4: event.target.value.replace(/\D/g, '') })
            }
          />
        </Field>
        <Field
          label="Opening balance"
          htmlFor="ba-opening"
          hint="For a card or line of credit, what you owe."
        >
          <MoneyInput
            id="ba-opening"
            allowNegative
            value={form.openingBalance}
            onChange={(value) => setForm({ ...form, openingBalance: value })}
          />
        </Field>
        <Field label="As of" htmlFor="ba-date">
          <Input
            id="ba-date"
            type="date"
            value={form.openingDate}
            onChange={(event) => setForm({ ...form, openingDate: event.target.value })}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function TransactionDialog({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts();
  const [form, setForm] = useState({
    bankAccountId: '',
    kind: 'DEPOSIT',
    date: todayIso(),
    amount: '',
    counterAccountId: '',
    toBankAccountId: '',
    description: '',
    reference: '',
  });
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const save = useAcctMutation(
    () =>
      acct.post('/bank-transactions', {
        ...form,
        counterAccountId:
          form.kind === 'TRANSFER' || form.kind === 'FEE'
            ? form.counterAccountId || null
            : form.counterAccountId,
        toBankAccountId: form.kind === 'TRANSFER' ? form.toBankAccountId : null,
        reference: form.reference || null,
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Record a bank transaction"
      description="For movements that are not a sale, bill, expense or payment: owner contributions, interest, transfers, bank fees."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.bankAccountId || !form.amount || !form.description}
            onClick={() => save.mutate(undefined)}
          >
            Post
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account" htmlFor="bt-bank">
          <BankSelect id="bt-bank" value={form.bankAccountId} onChange={set('bankAccountId')} />
        </Field>
        <Field label="Kind" htmlFor="bt-kind">
          <Select
            id="bt-kind"
            value={form.kind}
            onChange={(event) => set('kind')(event.target.value)}
          >
            {BANK_TRANSACTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {formatEnum(kind)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="bt-date">
          <Input
            id="bt-date"
            type="date"
            value={form.date}
            onChange={(event) => set('date')(event.target.value)}
          />
        </Field>
        <Field
          label="Amount"
          htmlFor="bt-amount"
          hint={form.kind === 'ADJUSTMENT' ? 'Negative to reduce the balance.' : undefined}
          error={fieldError(save.error, 'amount')}
        >
          <MoneyInput
            id="bt-amount"
            allowNegative={form.kind === 'ADJUSTMENT'}
            value={form.amount}
            onChange={set('amount')}
          />
        </Field>
        {form.kind === 'TRANSFER' ? (
          <Field
            label="To account"
            htmlFor="bt-to"
            className="sm:col-span-2"
            error={fieldError(save.error, 'toBankAccountId')}
          >
            <BankSelect id="bt-to" value={form.toBankAccountId} onChange={set('toBankAccountId')} />
          </Field>
        ) : (
          <Field
            label={form.kind === 'FEE' ? 'Expense account (default Bank Fees)' : 'Other side'}
            htmlFor="bt-counter"
            className="sm:col-span-2"
            error={fieldError(save.error, 'counterAccountId')}
          >
            <Select
              id="bt-counter"
              value={form.counterAccountId}
              onChange={(event) => set('counterAccountId')(event.target.value)}
            >
              <option value="">{form.kind === 'FEE' ? 'Bank Fees' : 'Choose an account'}</option>
              <AccountOptions
                accounts={accounts.data}
                filter={(account) => !account.isBankAccount}
              />
            </Select>
          </Field>
        )}
        <Field label="Description" htmlFor="bt-description" className="sm:col-span-2">
          <Input
            id="bt-description"
            value={form.description}
            onChange={(event) => set('description')(event.target.value)}
          />
        </Field>
        <Field
          label="Reference"
          htmlFor="bt-ref"
          className="sm:col-span-2"
          error={fieldError(save.error, 'reference')}
        >
          <Input
            id="bt-ref"
            value={form.reference}
            onChange={(event) => set('reference')(event.target.value)}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function StartReconciliationDialog({
  account,
  onClose,
  onStarted,
}: {
  account: BankAccount;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const [form, setForm] = useState({ statementDate: todayIso(), endingBalance: '' });
  const save = useAcctMutation(
    () => acct.post<{ id: string }>('/reconciliations', { bankAccountId: account.id, ...form }),
    (result) => onStarted(result.id),
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Reconcile ${account.name}`}
      description={
        account.lastReconciledDate
          ? `Last reconciled to ${isoDate(account.lastReconciledDate)}.`
          : 'First reconciliation: it starts from the opening balance.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.endingBalance}
            onClick={() => save.mutate(undefined)}
          >
            Start
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Statement end date" htmlFor="rec-date">
          <Input
            id="rec-date"
            type="date"
            value={form.statementDate}
            onChange={(event) => setForm({ ...form, statementDate: event.target.value })}
          />
        </Field>
        <Field label="Statement closing balance" htmlFor="rec-ending">
          <MoneyInput
            id="rec-ending"
            allowNegative
            value={form.endingBalance}
            onChange={(value) => setForm({ ...form, endingBalance: value })}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}
