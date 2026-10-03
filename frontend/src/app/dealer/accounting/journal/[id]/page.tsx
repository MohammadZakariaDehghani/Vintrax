'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { JOURNAL_SOURCE_LABELS, centsToDecimalString, type JournalSource } from '@vintrax/shared';
import { Button, Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import { Attachments } from '@/components/accounting/attachments';
import { useAccounting } from '@/components/accounting/context';
import { JournalEntryDialog, type JournalDraft } from '@/components/accounting/journal-form';
import { Amount, EntryStatus, Facts, PageHeader, ReasonDialog, useAcctMutation, useAcctQuery, vehicleLabel } from '@/components/accounting/ui';
import { acct, isoDate, sourceHref } from '@/lib/accounting';

interface EntryDetail {
  id: string;
  number: number;
  reference: string;
  date: string;
  description: string;
  memo: string | null;
  source: JournalSource;
  kind: string;
  status: 'DRAFT' | 'POSTED';
  totalCents: number;
  sourceType: string | null;
  sourceId: string | null;
  createdBy: string | null;
  createdAt: string;
  postedBy: string | null;
  postedAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  reversedBy: { id: string; reference: string } | null;
  reversalOf: { id: string; reference: string } | null;
  lines: Array<{
    id: string;
    lineNo: number;
    account: { id: string; code: string; name: string };
    debitCents: number;
    creditCents: number;
    description: string | null;
    vehicle: { id: string; vin: string | null; year: number; make: string; model: string; stockNumber: string | null } | null;
    customer: { id: string; name: string } | null;
    vendor: { id: string; name: string } | null;
    costCategory: string | null;
    taxType: string | null;
    reconciled: boolean;
  }>;
}

export default function JournalEntryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAccounting();
  const { data, error, isPending } = useAcctQuery<EntryDetail>(['journal-entry', id], `/journal/${id}`);
  const [reversing, setReversing] = useState(false);
  const [editing, setEditing] = useState<JournalDraft | null>(null);
  const post = useAcctMutation(() => acct.post(`/journal/${id}/post`));
  const remove = useAcctMutation(() => acct.delete(`/journal/${id}`), () => router.push('/dealer/accounting/journal'));

  if (isPending && !data) return <Spinner />;
  if (error || !data) return <ErrorAlert error={error} />;

  const debits = data.lines.reduce((sum, line) => sum + line.debitCents, 0);
  const credits = data.lines.reduce((sum, line) => sum + line.creditCents, 0);
  const source = sourceHref(data.sourceType, data.sourceId);
  const manual = data.source === 'MANUAL' || data.source === 'OPENING_BALANCE';

  return (
    <>
      <PageHeader
        title={`Journal entry ${data.reference}`}
        description={data.description}
        actions={
          <>
            {data.status === 'DRAFT' && can('accounting.edit') ? (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    setEditing({
                      id: data.id,
                      date: data.date,
                      description: data.description,
                      memo: data.memo ?? '',
                      kind: (['STANDARD', 'ADJUSTING', 'OPENING'].includes(data.kind) ? data.kind : 'STANDARD') as JournalDraft['kind'],
                      lines: data.lines.map((line) => ({
                        accountId: line.account.id,
                        debit: line.debitCents ? centsToDecimalString(line.debitCents) : '',
                        credit: line.creditCents ? centsToDecimalString(line.creditCents) : '',
                        description: line.description ?? '',
                      })),
                    })
                  }
                >
                  Edit draft
                </Button>
                <Button variant="outline" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
                  Delete draft
                </Button>
              </>
            ) : null}
            {data.status === 'DRAFT' && can('accounting.post') ? (
              <Button loading={post.isPending} onClick={() => post.mutate(undefined)}>
                Post entry
              </Button>
            ) : null}
            {data.status === 'POSTED' && !data.reversedAt && manual && can('accounting.reverse') ? (
              <Button variant="destructive" onClick={() => setReversing(true)}>
                Reverse entry
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorAlert error={post.error ?? remove.error} className="mb-4" />

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="pt-5">
            <Facts
              items={[
                ['Status', <EntryStatus key="s" status={data.status} reversed={Boolean(data.reversedAt)} />],
                ['Date', isoDate(data.date)],
                ['Source', JOURNAL_SOURCE_LABELS[data.source]],
                ['Type', data.kind.charAt(0) + data.kind.slice(1).toLowerCase()],
                ['Created', `${data.createdBy ?? '—'} · ${isoDate(data.createdAt)}`],
                ['Posted', data.postedAt ? `${data.postedBy ?? '—'} · ${isoDate(data.postedAt)}` : 'Not posted'],
                ...(source ? ([['Source document', <Link key="d" href={source} className="text-primary hover:underline">Open</Link>]] as Array<[string, React.ReactNode]>) : []),
                ...(data.reversalOf ? ([['Reverses', <Link key="r" href={`/dealer/accounting/journal/${data.reversalOf.id}`} className="text-primary hover:underline">{data.reversalOf.reference}</Link>]] as Array<[string, React.ReactNode]>) : []),
                ...(data.reversedBy ? ([['Reversed by', <Link key="rb" href={`/dealer/accounting/journal/${data.reversedBy.id}`} className="text-primary hover:underline">{data.reversedBy.reference}</Link>]] as Array<[string, React.ReactNode]>) : []),
                ...(data.reversalReason ? ([['Reversal reason', data.reversalReason]] as Array<[string, React.ReactNode]>) : []),
              ]}
            />
            {data.memo ? <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{data.memo}</p> : null}
            {!manual && data.status === 'POSTED' && !data.reversedAt ? (
              <p className="mt-4 text-xs text-muted-foreground">
                This entry was posted by its source document. To correct it, void or reverse the document itself.
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <Attachments entityType="JournalEntry" entityId={data.id} />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-secondary/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Account</th>
                <th className="px-3 py-2 text-left">Detail</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-3 py-2">
                    <Link href={`/dealer/accounting/ledger?accountId=${line.account.id}`} className="hover:text-primary">
                      {line.account.code} · {line.account.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {[
                      line.description,
                      line.vehicle ? vehicleLabel(line.vehicle) : null,
                      line.customer?.name,
                      line.vendor?.name,
                      line.taxType,
                      line.reconciled ? 'reconciled' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                  <td className="px-3 py-2 text-right">{line.debitCents ? <Amount cents={line.debitCents} /> : null}</td>
                  <td className="px-3 py-2 text-right">{line.creditCents ? <Amount cents={line.creditCents} /> : null}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-secondary/30 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={2}>
                  {debits === credits ? 'Balanced' : 'Out of balance'}
                </td>
                <td className="px-3 py-2 text-right"><Amount cents={debits} /></td>
                <td className="px-3 py-2 text-right"><Amount cents={credits} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <ReasonDialog
        open={reversing}
        title="Reverse this entry"
        description="Posts an equal and opposite entry. The original stays in the ledger, marked as reversed."
        confirmLabel="Reverse entry"
        onClose={() => setReversing(false)}
        onConfirm={(reason) => acct.post(`/journal/${data.id}/reverse`, { reason })}
      />
      {editing ? <JournalEntryDialog open initial={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
