'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui';
import { DataTable, PageHeader, StatusPill, useSupportQuery } from '@/components/crm/ui';
import { dateTime, humanize, personName, qs, support } from '@/lib/crm';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  _count: { supportTicketsRequested: number };
}

export default function AdminCrmUsersPage() {
  const [q, setQ] = useState('');
  const list = useSupportQuery<UserRow[]>(support, ['users', q], `/users${qs({ q })}`);
  return (
    <>
      <PageHeader
        title="Users"
        description="Open a user for their 360 view: account, dealer, tickets, communication and activity."
      />
      <Input
        type="search"
        aria-label="Search users"
        placeholder="Name, email or username"
        className="mb-4 max-w-sm"
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      <DataTable<UserRow>
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            label: 'User',
            render: (row) => (
              <Link href={`/admin/crm/users/${row.id}`} className="font-medium hover:underline">
                {personName(row)}
              </Link>
            ),
          },
          {
            key: 'email',
            label: 'Email',
            render: (row) => (
              <span>
                {row.email}
                {row.emailVerified ? (
                  ''
                ) : (
                  <span className="ml-1 text-xs text-warning">unverified</span>
                )}
              </span>
            ),
          },
          { key: 'role', label: 'Role', render: (row) => humanize(row.role) },
          { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
          {
            key: 'tickets',
            label: 'Tickets',
            align: 'right',
            render: (row) => row._count.supportTicketsRequested,
          },
          { key: 'since', label: 'Joined', render: (row) => dateTime(row.createdAt) },
        ]}
      />
    </>
  );
}
