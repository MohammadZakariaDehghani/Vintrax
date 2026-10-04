'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { VENDOR_KIND_LABELS, type VendorKind } from '@vintrax/shared';
import { Button, Input, Pagination } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { PartyDialog } from '@/components/accounting/pickers';
import { Amount, DataTable, PageHeader, useAcctQuery } from '@/components/accounting/ui';
import { qs, type Paged } from '@/lib/accounting';

interface Party {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city?: string | null;
  province: string | null;
  kind?: VendorKind;
  isActive: boolean;
  balanceCents: number;
}

export default function CustomersPage() {
  const { can } = useAccounting();
  const [tab, setTab] = useState<'customers' | 'vendors'>('customers');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const list = useAcctQuery<Paged<Party>>(
    [tab, q, page],
    `/${tab}${qs({ q, page, pageSize: 50 })}`,
  );
  const showVendors = can('accounting.view');

  return (
    <>
      <PageHeader
        title="Customers and vendors"
        description="Balances come from the ledger: what each customer owes you, and what you owe each vendor."
        actions={
          tab === 'customers' || can('accounting.create') ? (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New{' '}
              {tab === 'customers' ? 'customer' : 'vendor'}
            </Button>
          ) : null
        }
      />
      {showVendors ? (
        <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
          {(['customers', 'vendors'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={entry === tab}
              onClick={() => {
                setTab(entry);
                setPage(1);
              }}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize ${entry === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {entry}
            </button>
          ))}
        </div>
      ) : null}
      <Input
        type="search"
        aria-label="Search"
        placeholder="Search by name, email or phone"
        className="mb-4 max-w-sm"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setPage(1);
        }}
      />
      <DataTable
        loading={list.isPending}
        error={list.error}
        rows={list.data?.items}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            label: 'Name',
            render: (row) =>
              showVendors ? (
                <Link
                  href={`/dealer/accounting/${tab}/${row.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {row.name}
                </Link>
              ) : (
                <span className="font-medium">{row.name}</span>
              ),
          },
          ...(tab === 'vendors'
            ? [
                {
                  key: 'kind',
                  label: 'Kind',
                  render: (row: Party) => (row.kind ? VENDOR_KIND_LABELS[row.kind] : '—'),
                },
              ]
            : []),
          {
            key: 'contact',
            label: 'Contact',
            render: (row) => [row.email, row.phone].filter(Boolean).join(' · ') || '—',
          },
          {
            key: 'where',
            label: 'Province',
            render: (row) => [row.city, row.province].filter(Boolean).join(', ') || '—',
          },
          ...(showVendors
            ? [
                {
                  key: 'balance',
                  label: tab === 'customers' ? 'Owes you' : 'You owe',
                  align: 'right' as const,
                  render: (row: Party) => <Amount cents={row.balanceCents} />,
                },
              ]
            : []),
          {
            key: 'edit',
            label: '',
            align: 'right',
            render: (row) => (
              <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                Edit
              </Button>
            ),
          },
        ]}
      />
      {list.data ? (
        <Pagination page={list.data.page} totalPages={list.data.totalPages} onChange={setPage} />
      ) : null}
      {adding ? (
        <PartyDialog
          kind={tab === 'customers' ? 'customer' : 'vendor'}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? (
        <PartyDialog
          kind={tab === 'customers' ? 'customer' : 'vendor'}
          existing={{ ...editing }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
