'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CRM_RANGE_LABELS, CRM_RANGE_PRESETS, type CrmRangePreset } from '@vintrax/shared';
import { Badge, Card, CardContent, Input, Select } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import { crm, humanize, qs, type CrmClient, type LeadStatus } from '@/lib/crm';
import { useCrm } from './context';

export { DataTable, Facts, PageHeader, Section, type Column } from '@/components/accounting/ui';

// --- Data ---------------------------------------------------------------------------------

export function useCrmQuery<T>(key: unknown[], path: string, enabled = true, refetchInterval?: number) {
  const { dealerId } = useCrm();
  return useQuery({
    queryKey: ['crm', dealerId, ...key],
    queryFn: ({ signal }) => crm.get<T>(path, signal),
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval,
  });
}

/** A mutation that refreshes every CRM query afterwards: a status change moves counts everywhere. */
export function useCrmMutation<TInput, TResult = unknown>(
  fn: (input: TInput) => Promise<TResult>,
  onSuccess?: (result: TResult) => void,
  scope: string = 'crm',
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: [scope] });
      onSuccess?.(result);
    },
  });
}

/** Admin CRM queries (no dealership). */
export function useSupportQuery<T>(api: CrmClient, key: unknown[], path: string, enabled = true, refetchInterval?: number) {
  return useQuery({
    queryKey: ['support', ...key],
    queryFn: ({ signal }) => api.get<T>(path, signal),
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval,
  });
}

export function fieldError(error: unknown, name: string): string | undefined {
  return error instanceof ApiError ? error.details[name]?.[0] : undefined;
}

// --- Display ------------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: 'danger' | 'warning' | 'success' | 'hot';
}) {
  const body = (
    <Card className={cn('h-full transition-colors', href && 'hover:border-primary/60')}>
      <CardContent className="pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            'tabular mt-1 text-2xl font-bold',
            tone === 'danger' && 'text-destructive',
            tone === 'warning' && 'text-warning',
            tone === 'success' && 'text-success',
            tone === 'hot' && 'text-accent',
          )}
        >
          {value}
        </p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function TemperatureBadge({ temperature, score }: { temperature: 'HOT' | 'WARM' | 'COLD'; score?: number }) {
  const variant = temperature === 'HOT' ? 'destructive' : temperature === 'WARM' ? 'warning' : 'outline';
  return (
    <Badge variant={variant}>
      {humanize(temperature)}
      {score !== undefined ? ` · ${score}` : ''}
    </Badge>
  );
}

const KIND_VARIANT = { OPEN: 'primary', WON: 'success', LOST: 'destructive', NURTURE: 'warning', UNRESPONSIVE: 'outline' } as const;

export function LeadStatusBadge({ status }: { status: Pick<LeadStatus, 'label' | 'kind'> }) {
  return <Badge variant={KIND_VARIANT[status.kind]}>{status.label}</Badge>;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'outline' | 'primary' | 'destructive' | 'default'> = {
  SENT: 'success',
  DELIVERED: 'success',
  QUEUED: 'primary',
  SCHEDULED: 'primary',
  SENDING: 'warning',
  FAILED: 'destructive',
  BOUNCED: 'destructive',
  SUPPRESSED: 'outline',
  CANCELLED: 'outline',
  OPEN: 'primary',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CONFIRMED: 'success',
  NO_SHOW: 'destructive',
  ACTIVE: 'primary',
  WAITING: 'warning',
  STOPPED: 'outline',
  DRAFT: 'warning',
  NEW: 'primary',
  WAITING_FOR_USER: 'warning',
  WAITING_FOR_DEALER: 'warning',
  ESCALATED: 'destructive',
  RESOLVED: 'success',
  CLOSED: 'outline',
  URGENT: 'destructive',
  HIGH: 'warning',
  MEDIUM: 'default',
  LOW: 'outline',
};

export function StatusPill({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'default'}>{humanize(status)}</Badge>;
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: ReadonlyArray<{ id: T; label: string; count?: number }>;
  label: string;
}) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            tab.id === value
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="ml-1 text-xs text-muted-foreground">({tab.count})</span> : null}
        </button>
      ))}
    </div>
  );
}

export interface RangeValue {
  preset: CrmRangePreset;
  from: string;
  to: string;
}

export function rangeQuery(range: RangeValue): string {
  return qs({ preset: range.preset, from: range.preset === 'CUSTOM' ? range.from : undefined, to: range.preset === 'CUSTOM' ? range.to : undefined });
}

export function RangePicker({ value, onChange }: { value: RangeValue; onChange: (next: RangeValue) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="crm-range" className="text-xs font-medium text-muted-foreground">
          Period
        </label>
        <Select
          id="crm-range"
          className="h-9 w-44"
          value={value.preset}
          onChange={(event) => {
            const preset = event.target.value as CrmRangePreset;
            onChange(preset === 'CUSTOM' ? { preset, from: value.from || `${today.slice(0, 8)}01`, to: value.to || today } : { ...value, preset });
          }}
        >
          {CRM_RANGE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {CRM_RANGE_LABELS[preset]}
            </option>
          ))}
        </Select>
      </div>
      {value.preset === 'CUSTOM' ? (
        <>
          <Input aria-label="From" type="date" className="h-9 w-40" value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} />
          <Input aria-label="To" type="date" className="h-9 w-40" value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} />
        </>
      ) : null}
    </div>
  );
}

/** A link that looks like a button (never a button inside a link). */
export function LinkButton({
  href,
  children,
  variant = 'outline',
  size = 'default',
}: {
  href: string;
  children: ReactNode;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm';
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'outline' && 'border border-input bg-background hover:bg-secondary',
        variant === 'ghost' && 'hover:bg-secondary',
      )}
    >
      {children}
    </Link>
  );
}

/** A horizontal bar for small inline charts. */
export function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-secondary" aria-hidden>
      <div className={cn('h-2 rounded-full bg-primary', className)} style={{ width: `${width}%` }} />
    </div>
  );
}

/** Shows its children only when the caller holds the permission. The API checks regardless. */
export function CanCrm({ permission, children }: { permission: Parameters<ReturnType<typeof useCrm>['can']>[0]; children: ReactNode }) {
  const { can } = useCrm();
  return can(permission) ? <>{children}</> : null;
}
