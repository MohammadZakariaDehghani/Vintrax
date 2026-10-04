'use client';

import { AGING_BUCKETS, AGING_BUCKET_LABELS, type AgingBucket } from '@vintrax/shared';
import { Amount, DataTable, ExportButtons, Section, useAcctQuery } from './ui';
import { isoDate } from '@/lib/accounting';

interface AgingGroup {
  customer?: { id: string; name: string };
  vendor?: { id: string; name: string };
  buckets: Record<AgingBucket, number>;
  totalCents: number;
}

interface Aging {
  asOf: string;
  buckets: Record<AgingBucket, number>;
  totalCents: number;
  byCustomer?: AgingGroup[];
  byVendor?: AgingGroup[];
}

/** Receivables or payables by how long they have been due, per customer or vendor. */
export function AgingSummary({ kind }: { kind: 'ar' | 'ap' }) {
  const { data, error, isPending } = useAcctQuery<Aging>([`${kind}-aging`], `/reports/${kind}-aging`);
  const groups = (kind === 'ar' ? data?.byCustomer : data?.byVendor) ?? [];
  return (
    <Section
      title={kind === 'ar' ? 'Receivables aging' : 'Payables aging'}
      description={data ? `As of ${isoDate(data.asOf)}, by days past due.` : undefined}
      actions={<ExportButtons report={kind === 'ar' ? 'ar-aging' : 'ap-aging'} />}
    >
      <DataTable
        dense
        loading={isPending}
        error={error}
        rows={groups}
        rowKey={(row) => (row.customer ?? row.vendor)!.id}
        empty={<p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing outstanding.</p>}
        columns={[
          { key: 'name', label: kind === 'ar' ? 'Customer' : 'Vendor', render: (row) => (row.customer ?? row.vendor)!.name },
          ...AGING_BUCKETS.map((bucket) => ({ key: bucket, label: AGING_BUCKET_LABELS[bucket], align: 'right' as const, render: (row: AgingGroup) => (row.buckets[bucket] ? <Amount cents={row.buckets[bucket]} /> : null) })),
          { key: 'total', label: 'Total', align: 'right', render: (row) => <Amount cents={row.totalCents} strong /> },
        ]}
        footer={
          data && groups.length > 0 ? (
            <tr>
              <td className="px-3 py-1.5">Total</td>
              {AGING_BUCKETS.map((bucket) => (
                <td key={bucket} className="px-3 py-1.5 text-right"><Amount cents={data.buckets[bucket]} /></td>
              ))}
              <td className="px-3 py-1.5 text-right"><Amount cents={data.totalCents} /></td>
            </tr>
          ) : null
        }
      />
    </Section>
  );
}
