'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui';
import { DataTable, PageHeader, StatusPill, useSupportQuery } from '@/components/crm/ui';
import { dateTime, personName, qs, support } from '@/lib/crm';

interface DealerRow {
  id: string;
  name: string;
  status: string;
  verified: boolean;
  city: string | null;
  province: string | null;
  createdAt: string;
  owner: { id: string; email: string; firstName: string; lastName: string };
  _count: { supportTickets: number; staff: number };
}

export default function AdminCrmDealersPage() {
  const [q, setQ] = useState('');
  const list = useSupportQuery<DealerRow[]>(support, ['dealers', q], `/dealers${qs({ q })}`);
  return (
    <>
      <PageHeader
        title="Dealers"
        description="Open a dealer for its 360 view: account, staff, inventory, tickets, communication and history."
      />
      <Input
        type="search"
        aria-label="Search dealers"
        placeholder="Name, owner email or city"
        className="mb-4 max-w-sm"
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      <DataTable<DealerRow>
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            label: 'Dealer',
            render: (row) => (
              <Link href={`/admin/crm/dealers/${row.id}`} className="font-medium hover:underline">
                {row.name}
              </Link>
            ),
          },
          {
            key: 'owner',
            label: 'Owner',
            render: (row) => (
              <span>
                {personName(row.owner)}
                <span className="block text-xs text-muted-foreground">{row.owner.email}</span>
              </span>
            ),
          },
          {
            key: 'where',
            label: 'City',
            render: (row) => [row.city, row.province].filter(Boolean).join(', ') || '—',
          },
          {
            key: 'status',
            label: 'Account',
            render: (row) => (
              <span className="flex gap-1">
                <StatusPill status={row.status} />
                {row.verified ? <StatusPill status="CONFIRMED" /> : null}
              </span>
            ),
          },
          { key: 'staff', label: 'Staff', align: 'right', render: (row) => row._count.staff },
          {
            key: 'tickets',
            label: 'Open tickets',
            align: 'right',
            render: (row) => row._count.supportTickets,
          },
          { key: 'since', label: 'Joined', render: (row) => dateTime(row.createdAt) },
        ]}
      />
    </>
  );
}
