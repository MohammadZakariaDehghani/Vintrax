'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  VEHICLE_COST_CATEGORIES,
  VEHICLE_COST_CATEGORY_LABELS,
  formatCents,
  parseAmountToCents,
  type VehicleCostBreakdown,
  type VehicleCostCategory,
  type VehicleCostEntry,
  type VehicleCostInput,
} from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatEnum, formatPrice } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { DashboardNav } from '@/components/dashboard-nav';
import { DealerNav } from '@/components/dealer-nav';
import { STATUS_VARIANT, shortDate } from '../../inventory/inventory-items';
import { Margin } from '../margin';

/** Today, as the date input wants it, in the dealer's own time zone. */
function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** "2026-09-28" shown as a calendar date without shifting it through a time zone. */
function calendarDate(value: string): string {
  return shortDate(`${value}T12:00:00`);
}

interface FormState {
  category: VehicleCostCategory;
  description: string;
  amount: string;
  incurredOn: string;
  vendor: string;
  reference: string;
  notes: string;
}

function formFrom(entry: VehicleCostEntry | null, hasPurchase: boolean): FormState {
  if (!entry) {
    return {
      // The first cost recorded is nearly always what the car was bought for.
      category: hasPurchase ? 'MECHANICAL_REPAIR' : 'PURCHASE',
      description: '',
      amount: '',
      incurredOn: today(),
      vendor: '',
      reference: '',
      notes: '',
    };
  }
  return {
    category: entry.category,
    description: entry.description ?? '',
    amount: (entry.amountCents / 100).toFixed(2),
    incurredOn: entry.incurredOn,
    vendor: entry.vendor ?? '',
    reference: entry.reference ?? '',
    notes: entry.notes ?? '',
  };
}

function CostForm({
  vehicleId,
  entry,
  hasPurchase,
  onClose,
}: {
  vehicleId: string;
  entry: VehicleCostEntry | null;
  hasPurchase: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => formFrom(entry, hasPurchase));
  const [amountError, setAmountError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: (payload: VehicleCostInput) =>
      entry
        ? api.patch<VehicleCostEntry>(`/dealer/costs/${entry.id}`, payload)
        : api.post<VehicleCostEntry>(`/dealer/inventory/${vehicleId}/costs`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle-costs', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['dealer-costs'] });
      void queryClient.invalidateQueries({ queryKey: ['dealer-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['dealer-inventory-stats'] });
      onClose();
    },
  });

  const fieldError = (field: string) =>
    save.error instanceof ApiError ? save.error.details[field]?.[0] : undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const amountCents = parseAmountToCents(form.amount);
    if (amountCents === null || amountCents <= 0) {
      setAmountError('Enter an amount like 450 or 450.75.');
      return;
    }
    setAmountError(null);
    save.mutate({
      category: form.category,
      description: form.description.trim() || null,
      amountCents,
      incurredOn: form.incurredOn,
      vendor: form.vendor.trim() || null,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="cost-category">
          <Select
            id="cost-category"
            value={form.category}
            onChange={(event) => set('category', event.target.value as VehicleCostCategory)}
          >
            {VEHICLE_COST_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {VEHICLE_COST_CATEGORY_LABELS[category]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Amount (CAD)"
          htmlFor="cost-amount"
          error={amountError ?? fieldError('amountCents')}
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="cost-amount"
              inputMode="decimal"
              className="pl-7"
              placeholder="0.00"
              required
              value={form.amount}
              onChange={(event) => set('amount', event.target.value)}
              aria-invalid={Boolean(amountError)}
            />
          </div>
        </Field>
        <Field label="Date" htmlFor="cost-date" error={fieldError('incurredOn')}>
          <Input
            id="cost-date"
            type="date"
            required
            value={form.incurredOn}
            onChange={(event) => set('incurredOn', event.target.value)}
          />
        </Field>
        <Field label="Vendor (optional)" htmlFor="cost-vendor">
          <Input
            id="cost-vendor"
            maxLength={120}
            placeholder="e.g. Manheim, Joe's Auto Body"
            value={form.vendor}
            onChange={(event) => set('vendor', event.target.value)}
          />
        </Field>
        <Field label="Description (optional)" htmlFor="cost-description">
          <Input
            id="cost-description"
            maxLength={160}
            placeholder="e.g. Front brakes and rotors"
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </Field>
        <Field label="Reference / invoice # (optional)" htmlFor="cost-reference">
          <Input
            id="cost-reference"
            maxLength={80}
            value={form.reference}
            onChange={(event) => set('reference', event.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes (optional)" htmlFor="cost-notes">
        <Textarea
          id="cost-notes"
          rows={3}
          maxLength={2000}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
      </Field>
      <ErrorAlert error={save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {entry ? 'Save cost' : 'Add cost'}
        </Button>
      </div>
    </form>
  );
}

function Total({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? 'rounded-md bg-secondary px-3 py-2' : 'px-3 py-2'}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`tabular mt-0.5 ${emphasis ? 'text-2xl font-bold' : 'text-lg font-semibold'}`}>
        {children}
      </dd>
    </div>
  );
}

export function VehicleCosts({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<VehicleCostEntry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<VehicleCostEntry | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['vehicle-costs', vehicleId],
    queryFn: () => api.get<VehicleCostBreakdown>(`/dealer/inventory/${vehicleId}/costs`),
  });

  const remove = useMutation({
    mutationFn: (entry: VehicleCostEntry) => api.delete(`/dealer/costs/${entry.id}`),
    onSuccess: () => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['vehicle-costs', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['dealer-costs'] });
      void queryClient.invalidateQueries({ queryKey: ['dealer-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['dealer-inventory-stats'] });
    },
  });

  return (
    <div className="container py-8">
      <DashboardNav />
      <DealerNav />

      <Link
        href="/dealer/costs"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to cost overview
      </Link>

      {isPending ? <Spinner label="Loading costs" /> : null}
      <ErrorAlert error={error} className="mb-4" />

      {data ? (
        <>
          <Card className="mb-5">
            <CardContent className="flex flex-wrap items-center gap-4 pt-5">
              <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
                {data.vehicle.primaryImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.vehicle.primaryImageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">{data.vehicle.title}</h1>
                  <Badge variant={STATUS_VARIANT[data.vehicle.status]}>
                    {formatEnum(data.vehicle.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-mono">VIN {data.vehicle.vin ?? '—'}</span>
                  {data.vehicle.stockNumber ? ` · Stock #${data.vehicle.stockNumber}` : ''} · Asking{' '}
                  {formatPrice(data.vehicle.priceCad)}
                </p>
              </div>
              <Link href={`/dealer/inventory/${data.vehicle.id}`}>
                <Button variant="outline" size="sm">
                  Edit vehicle
                </Button>
              </Link>
            </CardContent>
          </Card>

          <dl className="mb-5 grid gap-2 rounded-lg border border-border bg-card p-2 sm:grid-cols-2 lg:grid-cols-5">
            <Total label="Total purchase cost">{formatCents(data.totals.purchaseCents)}</Total>
            <Total label="Total additional costs">{formatCents(data.totals.additionalCents)}</Total>
            <Total label="Total cost" emphasis>
              {formatCents(data.totals.totalCents)}
            </Total>
            <Total label="Current asking price">{formatPrice(data.vehicle.priceCad)}</Total>
            <Total label="Estimated gross margin" emphasis>
              <Margin cents={data.totals.grossMarginCents} />
            </Total>
          </dl>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <CardTitle>Cost breakdown</CardTitle>
              <Button onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" aria-hidden />
                Add Cost
              </Button>
            </CardHeader>
            <CardContent>
              {data.entries.length === 0 ? (
                <EmptyState
                  title="No costs recorded"
                  description="Start with what you paid for the vehicle, then add fees, transport, repairs and anything else it took to get it ready to sell."
                />
              ) : (
                <div className="-mx-4 overflow-x-auto sm:mx-0">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2">
                          Date
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Category
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Description
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Vendor
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Reference
                        </th>
                        <th scope="col" className="px-3 py-2 text-right">
                          Amount
                        </th>
                        <th scope="col" className="px-3 py-2 text-right">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.entries.map((entry) => (
                        <tr key={entry.id} className="align-top">
                          <td className="whitespace-nowrap px-3 py-2">
                            {calendarDate(entry.incurredOn)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={entry.category === 'PURCHASE' ? 'primary' : 'default'}>
                              {VEHICLE_COST_CATEGORY_LABELS[entry.category]}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            {entry.description ?? '—'}
                            {entry.notes ? (
                              <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                                {entry.notes}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{entry.vendor ?? '—'}</td>
                          <td className="px-3 py-2">{entry.reference ?? '—'}</td>
                          <td className="tabular px-3 py-2 text-right font-semibold">
                            {formatCents(entry.amountCents)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 px-0"
                                aria-label={`Edit ${VEHICLE_COST_CATEGORY_LABELS[entry.category]} cost`}
                                onClick={() => setEditing(entry)}
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 px-0 text-destructive hover:bg-destructive/10"
                                aria-label={`Delete ${VEHICLE_COST_CATEGORY_LABELS[entry.category]} cost`}
                                onClick={() => setDeleting(entry)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-border">
                      <tr>
                        <th scope="row" colSpan={5} className="px-3 py-2 text-right">
                          Total cost
                        </th>
                        <td className="tabular px-3 py-2 text-right font-bold">
                          {formatCents(data.totals.totalCents)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                Estimated gross margin = asking price − total cost. It is not profit: overheads,
                commissions and taxes are not included.
              </p>
            </CardContent>
          </Card>

          <Dialog
            open={editing !== null}
            onClose={() => setEditing(null)}
            title={editing === 'new' ? 'Add cost' : 'Edit cost'}
            description={data.vehicle.title}
            size="lg"
          >
            {editing !== null ? (
              <CostForm
                vehicleId={vehicleId}
                entry={editing === 'new' ? null : editing}
                hasPurchase={data.entries.some((entry) => entry.category === 'PURCHASE')}
                onClose={() => setEditing(null)}
              />
            ) : null}
          </Dialog>

          <Dialog
            open={deleting !== null}
            onClose={() => setDeleting(null)}
            title="Delete this cost?"
            size="sm"
            footer={
              <>
                <Button variant="ghost" onClick={() => setDeleting(null)}>
                  Keep it
                </Button>
                <Button
                  variant="destructive"
                  loading={remove.isPending}
                  onClick={() => deleting && remove.mutate(deleting)}
                >
                  Delete
                </Button>
              </>
            }
          >
            {deleting ? (
              <p className="text-sm">
                {VEHICLE_COST_CATEGORY_LABELS[deleting.category]} of{' '}
                <strong>{formatCents(deleting.amountCents)}</strong> on{' '}
                {calendarDate(deleting.incurredOn)}
                {deleting.vendor ? ` from ${deleting.vendor}` : ''}.
              </p>
            ) : null}
            <ErrorAlert error={remove.error} className="mt-3" />
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
