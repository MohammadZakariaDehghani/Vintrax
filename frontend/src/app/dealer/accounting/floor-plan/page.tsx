'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Dialog, ErrorAlert, Field, Input, Select } from '@/components/ui';
import { StatTile } from '@/components/stat-tile';
import { useAccounting } from '@/components/accounting/context';
import { BankSelect, VehicleSelect, VendorSelect } from '@/components/accounting/pickers';
import {
  Amount,
  Can,
  DataTable,
  MoneyInput,
  PageHeader,
  Section,
  StatusBadge,
  fieldError,
  useAcctMutation,
  useAcctQuery,
  vehicleLabel,
} from '@/components/accounting/ui';
import { acct, isoDate, money, todayIso } from '@/lib/accounting';

interface Note {
  id: string;
  lender: { id: string; name: string };
  vehicle: {
    id: string;
    vin: string | null;
    year: number;
    make: string;
    model: string;
    status: string;
  };
  principalCents: number;
  principalPaidCents: number;
  interestPaidCents: number;
  outstandingCents: number;
  interestRate: string;
  originationDate: string;
  maturityDate: string | null;
  daysOutstanding: number;
  status: string;
  reference: string | null;
  soldOutOfTrust: boolean;
}

interface FloorPlan {
  notes: Note[];
  summary: {
    totalOutstandingCents: number;
    totalInterestPaidCents: number;
    soldOutOfTrust: number;
    byLender: Array<{
      lender: { id: string; name: string };
      outstandingCents: number;
      interestPaidCents: number;
      vehicles: number;
    }>;
  };
}

export default function FloorPlanPage() {
  const { can } = useAccounting();
  const { data, error, isPending } = useAcctQuery<FloorPlan>(['floor-plan'], '/floor-plan');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Note | null>(null);

  return (
    <>
      <PageHeader
        title="Floor plan"
        description="Vehicles financed by a floor plan lender. The note is a liability until it is paid off — normally when the vehicle sells."
        actions={
          <Can permission="accounting.post">
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Floor-plan a vehicle
            </Button>
          </Can>
        }
      />
      {data ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <StatTile label="Owing to lenders" value={money(data.summary.totalOutstandingCents)} />
          <StatTile label="Interest paid" value={money(data.summary.totalInterestPaidCents)} />
          <StatTile
            label="Sold, not paid off"
            value={data.summary.soldOutOfTrust}
            hint="Pay these off now"
          />
        </div>
      ) : null}
      <Section title="Notes">
        <DataTable
          loading={isPending}
          error={error}
          rows={data?.notes}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'vehicle',
              label: 'Vehicle',
              render: (row) => (
                <span>
                  {vehicleLabel(row.vehicle)}
                  {row.soldOutOfTrust ? (
                    <Badge variant="destructive" className="ml-2">
                      Sold — pay off
                    </Badge>
                  ) : null}
                </span>
              ),
            },
            { key: 'lender', label: 'Lender', render: (row) => row.lender.name },
            {
              key: 'start',
              label: 'Since',
              render: (row) => `${isoDate(row.originationDate)} (${row.daysOutstanding} d)`,
            },
            {
              key: 'rate',
              label: 'Rate',
              align: 'right',
              render: (row) => `${Number(row.interestRate)}%`,
            },
            {
              key: 'status',
              label: 'Status',
              render: (row) => <StatusBadge status={row.status} />,
            },
            {
              key: 'principal',
              label: 'Advanced',
              align: 'right',
              render: (row) => <Amount cents={row.principalCents} />,
            },
            {
              key: 'interest',
              label: 'Interest paid',
              align: 'right',
              render: (row) => <Amount cents={row.interestPaidCents} />,
            },
            {
              key: 'owing',
              label: 'Owing',
              align: 'right',
              render: (row) => <Amount cents={row.outstandingCents} strong />,
            },
            {
              key: 'pay',
              label: '',
              align: 'right',
              render: (row) =>
                row.status === 'ACTIVE' && can('accounting.post') ? (
                  <Button size="sm" variant="ghost" onClick={() => setPaying(row)}>
                    Pay
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>
      {creating ? <NoteDialog onClose={() => setCreating(false)} /> : null}
      {paying ? <PayDialog note={paying} onClose={() => setPaying(null)} /> : null}
    </>
  );
}

function NoteDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    lenderVendorId: '',
    vehicleId: '',
    principal: '',
    interestRate: '',
    originationDate: todayIso(),
    maturityDate: '',
    bankAccountId: '',
    reference: '',
  });
  const save = useAcctMutation(
    () =>
      acct.post('/floor-plan', {
        ...form,
        maturityDate: form.maturityDate || null,
        reference: form.reference || null,
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Floor-plan a vehicle in stock"
      description="The lender's advance is deposited to your bank and owed back on the note."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={
              !form.lenderVendorId || !form.vehicleId || !form.principal || !form.bankAccountId
            }
            onClick={() => save.mutate(undefined)}
          >
            Post
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lender" htmlFor="fp-lender" className="sm:col-span-2">
          <VendorSelect
            id="fp-lender"
            kind="LENDER"
            value={form.lenderVendorId}
            onChange={(id) => setForm({ ...form, lenderVendorId: id })}
          />
        </Field>
        <Field
          label="Vehicle"
          htmlFor="fp-vehicle"
          className="sm:col-span-2"
          error={fieldError(save.error, 'vehicleId')}
        >
          <VehicleSelect
            id="fp-vehicle"
            value={form.vehicleId}
            onChange={(id) => setForm({ ...form, vehicleId: id })}
          />
        </Field>
        <Field label="Amount advanced" htmlFor="fp-principal">
          <MoneyInput
            id="fp-principal"
            value={form.principal}
            onChange={(value) => setForm({ ...form, principal: value })}
          />
        </Field>
        <Field label="Interest rate %" htmlFor="fp-rate">
          <Input
            id="fp-rate"
            inputMode="decimal"
            value={form.interestRate}
            onChange={(event) => setForm({ ...form, interestRate: event.target.value })}
          />
        </Field>
        <Field label="Date" htmlFor="fp-date">
          <Input
            id="fp-date"
            type="date"
            value={form.originationDate}
            onChange={(event) => setForm({ ...form, originationDate: event.target.value })}
          />
        </Field>
        <Field label="Matures" htmlFor="fp-maturity">
          <Input
            id="fp-maturity"
            type="date"
            value={form.maturityDate}
            onChange={(event) => setForm({ ...form, maturityDate: event.target.value })}
          />
        </Field>
        <Field label="Deposited to" htmlFor="fp-bank">
          <BankSelect
            id="fp-bank"
            value={form.bankAccountId}
            onChange={(id) => setForm({ ...form, bankAccountId: id })}
          />
        </Field>
        <Field label="Note reference" htmlFor="fp-ref">
          <Input
            id="fp-ref"
            value={form.reference}
            onChange={(event) => setForm({ ...form, reference: event.target.value })}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function PayDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  const [form, setForm] = useState({
    kind: 'PAYOFF',
    date: todayIso(),
    principal: '',
    interest: '',
    bankAccountId: '',
  });
  const save = useAcctMutation(
    () =>
      acct.post(`/floor-plan/${note.id}/payments`, {
        ...form,
        principal: form.principal || '0',
        interest: form.interest || '0',
      }),
    onClose,
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Pay ${note.lender.name}`}
      description={`${vehicleLabel(note.vehicle)} · ${money(note.outstandingCents)} owing`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.bankAccountId}
            onClick={() => save.mutate(undefined)}
          >
            Post payment
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Payment" htmlFor="pay-kind">
          <Select
            id="pay-kind"
            value={form.kind}
            onChange={(event) => setForm({ ...form, kind: event.target.value })}
          >
            <option value="PAYOFF">Pay off the note</option>
            <option value="PRINCIPAL_PAYMENT">Principal (curtailment)</option>
            <option value="INTEREST_PAYMENT">Interest</option>
          </Select>
        </Field>
        {form.kind !== 'INTEREST_PAYMENT' && form.kind !== 'PAYOFF' ? (
          <Field label="Principal" htmlFor="pay-principal">
            <MoneyInput
              id="pay-principal"
              value={form.principal}
              onChange={(value) => setForm({ ...form, principal: value })}
            />
          </Field>
        ) : null}
        <Field
          label="Interest"
          htmlFor="pay-interest"
          hint={form.kind === 'PAYOFF' ? 'Any interest paid with the payoff.' : undefined}
        >
          <MoneyInput
            id="pay-interest"
            value={form.interest}
            onChange={(value) => setForm({ ...form, interest: value })}
          />
        </Field>
        <Field label="Date" htmlFor="pay-date">
          <Input
            id="pay-date"
            type="date"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
          />
        </Field>
        <Field label="Paid from" htmlFor="pay-bank">
          <BankSelect
            id="pay-bank"
            value={form.bankAccountId}
            onChange={(id) => setForm({ ...form, bankAccountId: id })}
          />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}
