'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { parseMoneyToCents } from '@vintrax/shared';
import { Button, Dialog, ErrorAlert, Field, Input, Select, Textarea } from '@/components/ui';
import { acct, money, todayIso } from '@/lib/accounting';
import { useAccounting } from './context';
import { AccountOptions, MoneyInput, useAccounts, useAcctMutation } from './ui';

interface LineDraft {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

export interface JournalDraft {
  id?: string;
  date: string;
  description: string;
  memo: string;
  kind: 'STANDARD' | 'ADJUSTING' | 'OPENING';
  lines: LineDraft[];
}

const emptyLine = (): LineDraft => ({ accountId: '', debit: '', credit: '', description: '' });

export function newJournalDraft(): JournalDraft {
  return {
    date: todayIso(),
    description: '',
    memo: '',
    kind: 'STANDARD',
    lines: [emptyLine(), emptyLine()],
  };
}

/**
 * A manual journal entry: lines with a running debit and credit total. It
 * cannot be posted until the two agree (the server and the database refuse
 * an unbalanced entry regardless).
 */
export function JournalEntryDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: JournalDraft;
  onClose: () => void;
  onSaved?: (entry: { id: string }) => void;
}) {
  const { can } = useAccounting();
  const accounts = useAccounts();
  const [draft, setDraft] = useState<JournalDraft>(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setDraft(initial);
  }

  const cents = (value: string) => (value.trim() === '' ? 0 : (parseMoneyToCents(value) ?? NaN));
  const debits = draft.lines.reduce((sum, line) => sum + cents(line.debit), 0);
  const credits = draft.lines.reduce((sum, line) => sum + cents(line.credit), 0);
  const valid =
    Number.isFinite(debits) &&
    Number.isFinite(credits) &&
    debits > 0 &&
    debits === credits &&
    draft.description.trim().length > 0 &&
    draft.lines.every((line) => line.accountId && cents(line.debit) > 0 !== cents(line.credit) > 0);

  const save = useAcctMutation(
    (post: boolean) => {
      const body = {
        date: draft.date,
        description: draft.description,
        memo: draft.memo || null,
        kind: draft.kind,
        post,
        lines: draft.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit || '0',
          credit: line.credit || '0',
          description: line.description || null,
        })),
      };
      return draft.id
        ? acct.patch<{ id: string }>(`/journal/${draft.id}`, body).then(async (entry) => {
            if (post) await acct.post(`/journal/${draft.id}/post`);
            return entry;
          })
        : acct.post<{ id: string }>('/journal', body);
    },
    (entry) => {
      onSaved?.(entry);
      onClose();
    },
  );

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setDraft((previous) => ({
      ...previous,
      lines: previous.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={draft.id ? 'Edit draft entry' : 'New journal entry'}
      description="Manual and adjusting entries. Posted entries never change — corrections are reversals."
      footer={
        <>
          <span
            className={`mr-auto self-center text-sm ${debits === credits ? 'text-muted-foreground' : 'text-destructive'}`}
          >
            Debits {Number.isFinite(debits) ? money(debits) : '—'} · Credits{' '}
            {Number.isFinite(credits) ? money(credits) : '—'}
            {Number.isFinite(debits - credits) && debits !== credits
              ? ` · out by ${money(Math.abs(debits - credits))}`
              : ''}
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            loading={save.isPending && save.variables === false}
            disabled={!valid}
            onClick={() => save.mutate(false)}
          >
            Save draft
          </Button>
          {can('accounting.post') ? (
            <Button
              loading={save.isPending && save.variables === true}
              disabled={!valid}
              onClick={() => save.mutate(true)}
            >
              Post entry
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Date" htmlFor="je-date">
          <Input
            id="je-date"
            type="date"
            value={draft.date}
            onChange={(event) => setDraft({ ...draft, date: event.target.value })}
          />
        </Field>
        <Field label="Type" htmlFor="je-kind">
          <Select
            id="je-kind"
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: event.target.value as JournalDraft['kind'] })
            }
          >
            <option value="STANDARD">Standard</option>
            <option value="ADJUSTING">Adjusting</option>
            <option value="OPENING">Opening balance</option>
          </Select>
        </Field>
        <Field label="Description" htmlFor="je-description" className="sm:col-span-2">
          <Input
            id="je-description"
            maxLength={200}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-1 text-left">Account</th>
              <th className="py-1 text-left">Line note</th>
              <th className="w-32 py-1 text-right">Debit</th>
              <th className="w-32 py-1 text-right">Credit</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((line, index) => (
              <tr key={index}>
                <td className="py-1 pr-2">
                  <Select
                    aria-label={`Line ${index + 1} account`}
                    value={line.accountId}
                    onChange={(event) => setLine(index, { accountId: event.target.value })}
                  >
                    <option value="">Choose an account</option>
                    <AccountOptions accounts={accounts.data} />
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  <Input
                    aria-label={`Line ${index + 1} note`}
                    value={line.description}
                    onChange={(event) => setLine(index, { description: event.target.value })}
                  />
                </td>
                <td className="py-1 pr-2">
                  <MoneyInput
                    id={`je-debit-${index}`}
                    aria-label={`Line ${index + 1} debit`}
                    value={line.debit}
                    onChange={(value) =>
                      setLine(index, { debit: value, credit: value ? '' : line.credit })
                    }
                  />
                </td>
                <td className="py-1 pr-2">
                  <MoneyInput
                    id={`je-credit-${index}`}
                    aria-label={`Line ${index + 1} credit`}
                    value={line.credit}
                    onChange={(value) =>
                      setLine(index, { credit: value, debit: value ? '' : line.debit })
                    }
                  />
                </td>
                <td className="py-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={draft.lines.length <= 2}
                    onClick={() =>
                      setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
      </Button>
      <Field label="Memo" htmlFor="je-memo" className="mt-4">
        <Textarea
          id="je-memo"
          className="min-h-[70px]"
          value={draft.memo}
          onChange={(event) => setDraft({ ...draft, memo: event.target.value })}
        />
      </Field>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}
