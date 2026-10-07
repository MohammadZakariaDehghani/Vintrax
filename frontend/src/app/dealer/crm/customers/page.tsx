'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Input, Pagination } from '@/components/ui';
import { DataTable, PageHeader, useCrmQuery } from '@/components/crm/ui';
import { dateTime, qs, type Paged } from '@/lib/crm';

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  province: string | null;
  createdAt: string;
  crmLeads: Array<{ id: string; number: number; lastActivityAt: string | null; status: { label: string } }>;
  _count: { sales: number; deposits: number };
}

/**
 * The dealership's customers — the same Customer records accounting uses for
 * deals and deposits — with the CRM lead that carries their history.
 */
export default function CustomersPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useCrmQuery<Paged<CustomerRow>>(['customers', q, page], `/customers${qs({ q, page, pageSize: 25 })}`);
  return (
    <>
      <PageHeader
        title="Customers"
        description="People who have bought, or are buying, from you. Open the lead for the full relationship history."
      />
      <Input
        type="search"
        aria-label="Search customers"
        placeholder="Name, email or phone"
        className="mb-4 max-w-sm"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setPage(1);
        }}
      />
      <DataTable<CustomerRow>
        rows={list.data?.items}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            label: 'Customer',
            render: (row) =>
              row.crmLeads[0] ? (
                <Link href={`/dealer/crm/leads/${row.crmLeads[0].id}`} className="font-medium hover:underline">
                  {row.name}
                </Link>
              ) : (
                <span className="font-medium">{row.name}</span>
              ),
          },
          { key: 'contact', label: 'Email / phone', render: (row) => [row.email, row.phone].filter(Boolean).join(' · ') || '—' },
          { key: 'place', label: 'City', render: (row) => [row.city, row.province].filter(Boolean).join(', ') || '—' },
          { key: 'lead', label: 'CRM status', render: (row) => row.crmLeads[0]?.status.label ?? 'No lead' },
          { key: 'sales', label: 'Purchases', align: 'right', render: (row) => row._count.sales },
          { key: 'activity', label: 'Last activity', render: (row) => dateTime(row.crmLeads[0]?.lastActivityAt) },
        ]}
      />
      <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onChange={setPage} />
    </>
  );
}
