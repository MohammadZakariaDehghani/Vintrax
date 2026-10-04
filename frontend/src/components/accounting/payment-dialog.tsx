'use client';

import { useEffect, useState } from 'react';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, parseMoneyToCents } from '@vintrax/shared';
import { Button, Dialog, ErrorAlert, Field, Input, Select, Textarea } from '@/components/ui';
import { acct, centsInput, isoDate, money, qs, todayIso } from '@/lib/accounting';
import { BankSelect, CustomerSelect, VendorSelect } from './pickers';
import { MoneyInput, fieldError, useAcctMutation, useAcctQuery } from './ui';

interface OpenDocument {
  id: string;
  number: string | number;
  date: string;
  dueDate: string;
  balanceCents: number;
  kind?: string;
  vendorReference?: string | null;
}

/**
 * A payment received from a customer or sent to a vendor, applied to their
 * open invoices or bills. Anything not applied stays on account. Card
 * payments are recorded by method and receipt reference only.
 */
export function PaymentDialog({
  direction,
  partyId: initialParty = '',
  documentId,
  onClose,
}: {
  direction: 'RECEIVED' | 'SENT';
  partyId?: string;
  documentId?: string;
  onClose: () => void;
}) {
  const received = direction === 'RECEIVED';
  const [partyId, setPartyId] = useState(initialParty);
  const [form, setForm] = useState({
    date: todayIso(),
    amount: '',
    method: received ? 'E_TRANSFER' : 'BANK_TRANSFER',
    reference: '',
    bankAccountId: '',
    notes: '',
  });
  const [applied, setApplied] = useState<Record<string, string>>({});

  const docs = useAcctQuery<OpenDocument[]>(
    ['open-docs', direction, partyId],
    received
      ? `/invoices${qs({ customerId: partyId, openOnly: 'true' })}`
      : `/bills${qs({ vendorId: partyId })}`,
    Boolean(partyId),
  );
  const open = (docs.data ?? []).filter(
    (doc) => doc.balanceCents > 0 && (received || doc.kind === 'BILL'),
  );

  // Preselect the document the dialog was opened from, for its full balance.
  useEffect(() => {
    if (!documentId) return;
    const doc = open.find((entry) => entry.id === documentId);
    if (doc && applied[doc.id] === undefined) {
      setApplied({ [doc.id]: centsInput(doc.balanceCents) });
      setForm((previous) => ({
        ...previous,
        amount: previous.amount || centsInput(doc.balanceCents),
      }));
    }
  }, [documentId, open, applied]);

  const appliedTotal = Object.values(applied).reduce(
    (sum, value) => sum + (parseMoneyToCents(value || '0') ?? 0),
    0,
  );
  const amount = parseMoneyToCents(form.amount || '0') ?? 0;

  const save = useAcctMutation(
    () =>
      acct.post('/payments', {
        direction,
        kind: 'PAYMENT',
        customerId: received ? partyId : null,
        vendorId: received ? null : partyId,
        date: form.date,
        amount: form.amount,
        method: form.method,
        reference: form.reference || null,
        bankAccountId: form.bankAccountId,
        notes: form.notes || null,
        allocations: Object.entries(applied)
          .filter(([, value]) => value)
          .map(([id, value]) =>
            received ? { invoiceId: id, amount: value } : { billId: id, amount: value },
          ),
      }),
    onClose,
  );

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={received ? 'Receive a payment' : 'Pay a vendor'}
      description="Card payments: record the method and receipt reference only — never a card number."
      footer={
        <>
          <span
            className={`mr-auto self-center text-sm ${appliedTotal > amount ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            Applied {money(appliedTotal)} of {money(amount)}
            {amount > appliedTotal ? ` · ${money(amount - appliedTotal)} on account` : ''}
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!partyId || !amount || !form.bankAccountId || appliedTotal > amount}
            onClick={() => save.mutate(undefined)}
          >
            Post payment
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label={received ? 'Customer' : 'Vendor'}
          htmlFor="pay-party"
          className="sm:col-span-3"
        >
          {received ? (
            <CustomerSelect
              id="pay-party"
              value={partyId}
              onChange={(id) => {
                setPartyId(id);
                setApplied({});
              }}
            />
          ) : (
            <VendorSelect
              id="pay-party"
              value={partyId}
              onChange={(id) => {
                setPartyId(id);
                setApplied({});
              }}
            />
          )}
        </Field>
        <Field label="Date" htmlFor="pay-date">
          <Input
            id="pay-date"
            type="date"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
          />
        </Field>
        <Field label="Amount" htmlFor="pay-amount" error={fieldError(save.error, 'amount')}>
          <MoneyInput
            id="pay-amount"
            value={form.amount}
            onChange={(value) => setForm({ ...form, amount: value })}
          />
        </Field>
        <Field label="Method" htmlFor="pay-method">
          <Select
            id="pay-method"
            value={form.method}
            onChange={(event) => setForm({ ...form, method: event.target.value })}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={received ? 'Deposited to' : 'Paid from'} htmlFor="pay-bank">
          <BankSelect
            id="pay-bank"
            value={form.bankAccountId}
            onChange={(id) => setForm({ ...form, bankAccountId: id })}
          />
        </Field>
        <Field
          label="Reference"
          htmlFor="pay-ref"
          className="sm:col-span-2"
          error={fieldError(save.error, 'reference')}
          hint="Cheque number, transfer or receipt reference."
        >
          <Input
            id="pay-ref"
            value={form.reference}
            onChange={(event) => setForm({ ...form, reference: event.target.value })}
          />
        </Field>
      </div>
      {partyId ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">
            Apply to open {received ? 'invoices' : 'bills'}
          </p>
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing open. The payment will sit on account.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {open.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={applied[doc.id] !== undefined}
                      onChange={(event) =>
                        setApplied((previous) => {
                          const next = { ...previous };
                          if (event.target.checked) next[doc.id] = centsInput(doc.balanceCents);
                          else delete next[doc.id];
                          return next;
                        })
                      }
                    />
                    <span className="truncate">
                      {received
                        ? doc.number
                        : `#${doc.number}${doc.vendorReference ? ` (${doc.vendorReference})` : ''}`}{' '}
                      · due {isoDate(doc.dueDate)} · {money(doc.balanceCents)} open
                    </span>
                  </label>
                  {applied[doc.id] !== undefined ? (
                    <div className="w-32">
                      <MoneyInput
                        id={`apply-${doc.id}`}
                        aria-label="Amount applied"
                        value={applied[doc.id]!}
                        onChange={(value) => setApplied({ ...applied, [doc.id]: value })}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <Field label="Notes" htmlFor="pay-notes" className="mt-3">
        <Textarea
          id="pay-notes"
          className="min-h-[50px]"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </Field>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}
