'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataTable, LinkButton, PageHeader, StatusPill, useSupportQuery } from '@/components/crm/ui';
import { dateTime, humanize, support, type TemplateRow } from '@/lib/crm';

export default function AdminCrmTemplatesPage() {
  const list = useSupportQuery<TemplateRow[]>(support, ['templates'], '/templates');
  return (
    <>
      <PageHeader
        title="Support email templates"
        description="Ticket confirmations, replies and follow-ups, with variables like {{ticket.number}}."
        actions={
          <LinkButton href="/admin/crm/templates/new" variant="default">
            <Plus className="h-4 w-4" aria-hidden /> New template
          </LinkButton>
        }
      />
      <DataTable<TemplateRow>
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          { key: 'name', label: 'Template', render: (row) => <Link href={`/admin/crm/templates/${row.id}`} className="font-medium hover:underline">{row.name}</Link> },
          { key: 'subject', label: 'Subject', render: (row) => <span className="text-sm text-muted-foreground">{row.subject}</span> },
          { key: 'category', label: 'Category', render: (row) => humanize(row.category) },
          { key: 'active', label: 'State', render: (row) => <StatusPill status={row.isActive ? 'ACTIVE' : 'STOPPED'} /> },
          { key: 'used', label: 'Sent', align: 'right', render: (row) => row._count.emails },
          { key: 'updated', label: 'Updated', render: (row) => `v${row.version} · ${dateTime(row.updatedAt)}` },
        ]}
      />
    </>
  );
}
