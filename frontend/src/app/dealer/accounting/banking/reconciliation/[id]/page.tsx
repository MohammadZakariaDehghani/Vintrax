'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  ErrorAlert,
  Field,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import {
  AccountOptions,
  Amount,
  PageHeader,
  StatusBadge,
  useAccounts,
  useAcctMutation,
  useAcctQuery,
} from '@/components/accounting/ui';
import { acct, isoDate, money } from '@/lib/accounting';

interface ReconciliationView {
  id: string;
  bankAccount: { id: string; name: string };
  statementDate: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  beginningBalanceCents: number;
  statementBalanceCents: number;
  bookBalanceCents: number;
  clearedBalanceCents: number;
  differenceCents: number;
  unreconciledCount: number;
  items: Array<{
    lineId: string;
    date: string;
    reference: string;
    description: string;
    journalEntryId: string;
    amountCents: number;
    cleared: boolean;
  }>;
  adjustmentEntryId: string | null;
  adjustmentReason: string | null;
}

export default function ReconciliationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAccounting();
  const { data, error, isPending } = useAcctQuery<ReconciliationView>(
    ['reconciliation', id],
    `/reconciliations/${id}`,
  );
  const [cleared, setCleared] = useState<Set<string> | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  useEffect(() => {
    if (data && cleared === null)
      setCleared(new Set(data.items.filter((item) => item.cleared).map((item) => item.lineId)));
  }, [data, cleared]);

  const save = useAcctMutation((ids: string[]) =>
    acct.patch(`/reconciliations/${id}/cleared`, { clearedLineIds: ids }),
  );
  const complete = useAcctMutation((adjustment: { accountId: string; reason: string } | null) =>
    acct.post(`/reconciliations/${id}/complete`, { adjustment }),
  );
  const discard = useAcctMutation(
    () => acct.delete(`/reconciliations/${id}`),
    () => router.push('/dealer/accounting/banking'),
  );

  if (isPending && !data) return <Spinner />;
  if (error || !data) return <ErrorAlert error={error} />;

  const editable = data.status === 'IN_PROGRESS' && can('accounting.reconcile_bank');
  const selected = cleared ?? new Set<string>();
  // Work the figures out locally so ticking a line updates them at once.
  const clearedBalance =
    data.beginningBalanceCents +
    data.items
      .filter((item) => selected.has(item.lineId))
      .reduce((sum, item) => sum + item.amountCents, 0);
  const difference = data.statementBalanceCents - clearedBalance;

  const toggle = (lineId: string) => {
    const next = new Set(selected);
    if (next.has(lineId)) next.delete(lineId);
    else next.add(lineId);
    setCleared(next);
    save.mutate([...next]);
  };

  return (
    <>
      <PageHeader
        title={`Reconcile ${data.bankAccount.name}`}
        description={`Statement to ${isoDate(data.statementDate)}. Tick each item that appears on the statement; the difference must reach zero.`}
        actions={
          editable ? (
            <>
              <Button
                variant="outline"
                loading={discard.isPending}
                onClick={() => discard.mutate(undefined)}
              >
                Discard
              </Button>
              {difference !== 0 ? (
                <Button variant="outline" onClick={() => setAdjusting(true)}>
                  Complete with adjustment
                </Button>
              ) : null}
              <Button
                disabled={difference !== 0 || save.isPending}
                loading={complete.isPending}
                onClick={() => complete.mutate(null)}
              >
                Complete
              </Button>
            </>
          ) : (
            <StatusBadge status={data.status} />
          )
        }
      />
      <ErrorAlert error={save.error ?? complete.error ?? discard.error} className="mb-4" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Beginning balance', data.beginningBalanceCents],
          ['Statement balance', data.statementBalanceCents],
          ['Cleared balance', clearedBalance],
          ['Book balance', data.bookBalanceCents],
          ['Difference', difference],
        ].map(([label, value]) => (
          <Card
            key={label as string}
            className={
              label === 'Difference'
                ? difference === 0
                  ? 'border-success'
                  : 'border-warning'
                : undefined
            }
          >
            <CardContent className="pt-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
              <p className="text-xl font-bold">
                <Amount cents={value as number} />
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {data.adjustmentReason ? (
        <p className="mb-4 text-sm">
          Completed with an adjustment: {data.adjustmentReason}.{' '}
          {data.adjustmentEntryId ? (
            <Link
              href={`/dealer/accounting/journal/${data.adjustmentEntryId}`}
              className="text-primary hover:underline"
            >
              Adjustment entry
            </Link>
          ) : null}
        </p>
      ) : null}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-secondary/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-12 px-3 py-2">Cleared</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Entry</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((item) => (
                <tr
                  key={item.lineId}
                  className={selected.has(item.lineId) ? 'bg-success/5' : undefined}
                >
                  <td className="px-3 py-1.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Cleared: ${item.description}`}
                      disabled={!editable}
                      checked={selected.has(item.lineId)}
                      onChange={() => toggle(item.lineId)}
                    />
                  </td>
                  <td className="px-3 py-1.5">{isoDate(item.date)}</td>
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/dealer/accounting/journal/${item.journalEntryId}`}
                      className="text-primary hover:underline"
                    >
                      {item.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{item.description}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Amount cents={item.amountCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {adjusting ? (
        <AdjustmentDialog
          difference={difference}
          onClose={() => setAdjusting(false)}
          onConfirm={(adjustment) => complete.mutateAsync(adjustment)}
        />
      ) : null}
    </>
  );
}

function AdjustmentDialog({
  difference,
  onClose,
  onConfirm,
}: {
  difference: number;
  onClose: () => void;
  onConfirm: (adjustment: { accountId: string; reason: string }) => Promise<unknown>;
}) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Complete with an adjustment"
      description={`Posts ${money(difference)} so the books match the statement. Use it only for a difference you have explained.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            disabled={!accountId || !reason.trim()}
            onClick={() => {
              setBusy(true);
              onConfirm({ accountId, reason: reason.trim() })
                .then(onClose)
                .catch(setError)
                .finally(() => setBusy(false));
            }}
          >
            Post adjustment
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Account" htmlFor="adj-account">
          <Select
            id="adj-account"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">Choose an account</option>
            <AccountOptions accounts={accounts.data} filter={(account) => !account.isBankAccount} />
          </Select>
        </Field>
        <Field label="Reason" htmlFor="adj-reason">
          <Textarea
            id="adj-reason"
            className="min-h-[70px]"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
      <ErrorAlert error={error} className="mt-3" />
    </Dialog>
  );
}
