'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_LABELS,
  parseMoneyToCents,
  type DateRangePreset,
  type ExportableReport,
} from '@vintrax/shared';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import {
  acct,
  isPreset,
  money,
  qs,
  rangeParams,
  todayIso,
  type AccountOption,
  type RangeState,
} from '@/lib/accounting';
import { useAccounting } from './context';

// --- Page structure -----------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-8', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Shows its children only to callers with the permission. The API enforces it regardless. */
export function Can({ permission, children }: { permission: Parameters<ReturnType<typeof useAccounting>['can']>[0]; children: ReactNode }) {
  const { can } = useAccounting();
  return can(permission) ? <>{children}</> : null;
}

// --- Tables ------------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  label: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  render: (row: T) => ReactNode;
}

/**
 * A plain data table that scrolls sideways on a narrow screen rather than
 * squeezing amounts into unreadable columns.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  footer,
  loading,
  error,
  dense,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  error?: unknown;
  dense?: boolean;
}) {
  if (error) return <ErrorAlert error={error} />;
  if (loading && !rows) return <Spinner />;
  const cell = dense ? 'px-3 py-1.5' : 'px-3 py-2';
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(cell, 'whitespace-nowrap font-semibold', alignClass(column.align), column.className)}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows && rows.length > 0 ? (
              rows.map((row, index) => (
                <tr key={rowKey(row, index)} className="hover:bg-secondary/30">
                  {columns.map((column) => (
                    <td key={column.key} className={cn(cell, alignClass(column.align), column.className)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  {empty ?? <EmptyState title="Nothing here yet" />}
                </td>
              </tr>
            )}
          </tbody>
          {footer ? <tfoot className="border-t-2 border-border bg-secondary/30 font-semibold">{footer}</tfoot> : null}
        </table>
      </div>
    </Card>
  );
}

function alignClass(align: Column<unknown>['align']) {
  return align === 'right' ? 'text-right tabular' : align === 'center' ? 'text-center' : 'text-left';
}

export function Amount({ cents, strong, muted }: { cents: number | null | undefined; strong?: boolean; muted?: boolean }) {
  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        strong && 'font-semibold',
        muted && 'text-muted-foreground',
        typeof cents === 'number' && cents < 0 && 'text-destructive',
      )}
    >
      {money(cents)}
    </span>
  );
}

// --- Filters --------------------------------------------------------------------------------

export function RangeFilter({
  value,
  onChange,
  presets = DATE_RANGE_PRESETS,
}: {
  value: RangeState;
  onChange: (next: RangeState) => void;
  presets?: readonly DateRangePreset[];
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="range-preset" className="text-xs font-medium text-muted-foreground">
          Period
        </label>
        <Select
          id="range-preset"
          className="h-9 w-48"
          value={value.preset}
          onChange={(event) => {
            const preset = event.target.value;
            if (!isPreset(preset)) return;
            const today = todayIso();
            onChange(
              preset === 'CUSTOM'
                ? { preset, from: value.from || `${today.slice(0, 8)}01`, to: value.to || today }
                : { ...value, preset },
            );
          }}
        >
          {presets.map((preset) => (
            <option key={preset} value={preset}>
              {DATE_RANGE_PRESET_LABELS[preset]}
            </option>
          ))}
        </Select>
      </div>
      {value.preset === 'CUSTOM' ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="range-from" className="text-xs font-medium text-muted-foreground">
              From
            </label>
            <Input id="range-from" type="date" className="h-9 w-40" value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="range-to" className="text-xs font-medium text-muted-foreground">
              To
            </label>
            <Input id="range-to" type="date" className="h-9 w-40" value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} />
          </div>
        </>
      ) : null}
    </div>
  );
}

export function RangeLabel({ range }: { range?: { from: string; to: string } | null }) {
  if (!range) return null;
  return (
    <span className="text-sm text-muted-foreground">
      {range.from} to {range.to}
    </span>
  );
}

/** CSV, Excel and PDF buttons for one report with its current filters. */
export function ExportButtons({
  report,
  params = {},
}: {
  report: ExportableReport;
  params?: Record<string, string | number | boolean | null | undefined>;
}) {
  const { can } = useAccounting();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!can('accounting.export')) return null;
  const run = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setBusy(format);
    setError(null);
    try {
      await acct.save(`/exports/${report}${qs({ ...params, format })}`, `${report}-${todayIso()}.${format}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1" role="group" aria-label="Export">
        {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
          <Button key={format} size="sm" variant="outline" loading={busy === format} onClick={() => void run(format)}>
            {busy === format ? null : <Download className="h-3.5 w-3.5" aria-hidden />}
            {format === 'xlsx' ? 'Excel' : format.toUpperCase()}
          </Button>
        ))}
      </div>
      {error ? <ErrorAlert error={error} className="py-1 text-xs" /> : null}
    </div>
  );
}

// --- Mutations and options ----------------------------------------------------------------

/** A mutation that refreshes every accounting query afterwards — the books are one ledger. */
export function useAcctMutation<TInput, TResult = unknown>(
  fn: (input: TInput) => Promise<TResult>,
  onSuccess?: (result: TResult) => void,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['acct'] });
      onSuccess?.(result);
    },
  });
}

export function useAcctQuery<T>(key: unknown[], path: string, enabled = true) {
  const { dealerId } = useAccounting();
  return useQuery({
    queryKey: ['acct', dealerId, ...key],
    queryFn: ({ signal }) => acct.get<T>(path, signal),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useAccounts(enabled = true) {
  return useAcctQuery<AccountOption[]>(['accounts'], '/accounts', enabled);
}

export interface BankOption {
  id: string;
  name: string;
  type: string;
}

export function useBankOptions() {
  return useAcctQuery<BankOption[]>(['bank-options'], '/bank-accounts/options');
}

export interface PartyOption {
  id: string;
  name: string;
  kind?: string;
  balanceCents?: number;
}

export function useCustomers(q = '') {
  return useAcctQuery<Paged<PartyOption>>(['customers', q], `/customers${qs({ q, pageSize: 200 })}`);
}

export function useVendors(kind?: string) {
  const { can } = useAccounting();
  return useAcctQuery<Paged<PartyOption>>(['vendors', kind], `/vendors${qs({ kind, pageSize: 200 })}`, can('accounting.view'));
}

export interface VehicleOption {
  id: string;
  vin: string | null;
  stockNumber: string | null;
  label: string;
  status: string;
  askingPriceCents: number;
}

export function useVehicleOptions(q = '', includeSold = false) {
  return useAcctQuery<VehicleOption[]>(['vehicles', q, includeSold], `/vehicles${qs({ q, includeSold: includeSold ? 'true' : undefined })}`);
}

interface Paged<T> {
  items: T[];
  total: number;
}

export function vehicleLabel(vehicle: { label?: string; year?: number; make?: string; model?: string; vin?: string | null; stockNumber?: string | null } | null | undefined) {
  if (!vehicle) return '—';
  const name = vehicle.label ?? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim();
  const id = vehicle.stockNumber ? `#${vehicle.stockNumber}` : vehicle.vin ? `…${vehicle.vin.slice(-6)}` : '';
  return id ? `${name} (${id})` : name;
}

// --- Form helpers ----------------------------------------------------------------------------

/** Account <option>s grouped by type, active accounts only. */
export function AccountOptions({ accounts, filter }: { accounts: AccountOption[] | undefined; filter?: (account: AccountOption) => boolean }) {
  const list = (accounts ?? []).filter((account) => account.isActive && (!filter || filter(account)));
  const groups = new Map<string, AccountOption[]>();
  for (const account of list) groups.set(account.type, [...(groups.get(account.type) ?? []), account]);
  return (
    <>
      {[...groups.entries()].map(([type, items]) => (
        <optgroup key={type} label={type.charAt(0) + type.slice(1).toLowerCase()}>
          {items.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} · {account.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/** A money input that keeps what the person typed and reports whether it parses. */
export function MoneyInput({
  id,
  value,
  onChange,
  allowNegative,
  ...rest
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  allowNegative?: boolean;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const cents = value.trim() === '' ? 0 : parseMoneyToCents(value);
  const invalid = cents === null || (!allowNegative && cents < 0);
  return (
    <Input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      placeholder={rest.placeholder ?? '0.00'}
      {...rest}
    />
  );
}

/** Asks for the reason a correction needs, then runs it. */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  optional,
  destructive = true,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  optional?: boolean;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      await client.invalidateQueries({ queryKey: ['acct'] });
      setReason('');
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            loading={busy}
            disabled={!optional && reason.trim().length === 0}
            onClick={() => void submit()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={optional ? 'Reason (optional)' : 'Reason'} htmlFor="reason" hint="Kept in the audit trail.">
        <Textarea id="reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {error ? <ErrorAlert error={error} className="mt-3" /> : null}
    </Dialog>
  );
}

/** Small key/value summary list. */
export function Facts({ items }: { items: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
      {items.map(([label, value], index) => (
        <div key={index} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export { rangeParams };

export function EntryStatus({ status, reversed }: { status: string; reversed?: boolean }) {
  if (reversed) return <Badge variant="outline">Reversed</Badge>;
  return status === 'POSTED' ? <Badge variant="success">Posted</Badge> : <Badge variant="warning">Draft</Badge>;
}

const DOCUMENT_VARIANT: Record<string, 'success' | 'warning' | 'outline' | 'primary' | 'destructive' | 'default'> = {
  POSTED: 'success',
  OPEN: 'primary',
  PARTIAL: 'warning',
  PARTIALLY_APPLIED: 'warning',
  PAID: 'success',
  APPLIED: 'success',
  VOID: 'outline',
  REVERSED: 'outline',
  REFUNDED: 'outline',
  DRAFT: 'warning',
  ACTIVE: 'primary',
  PAID_OFF: 'success',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  IN_REVIEW: 'warning',
  FILED: 'success',
  CLOSED: 'outline',
  APPRAISED: 'primary',
  ACQUIRED: 'success',
  WITHDRAWN: 'outline',
};

/** Any document status as a coloured pill. */
export function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
  return <Badge variant={DOCUMENT_VARIANT[status] ?? 'default'}>{label}</Badge>;
}

/** The first validation message the API gave for one field, if any. */
export function fieldError(error: unknown, name: string): string | undefined {
  return error instanceof ApiError ? error.details[name]?.[0] : undefined;
}
