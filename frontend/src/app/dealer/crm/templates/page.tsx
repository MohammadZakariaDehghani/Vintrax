'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useCrm } from '@/components/crm/context';
import { DataTable, LinkButton, PageHeader, StatusPill, useCrmQuery } from '@/components/crm/ui';
import { dateTime, humanize, type TemplateRow } from '@/lib/crm';

export default function TemplatesPage() {
  const { can } = useCrm();
  const list = useCrmQuery<TemplateRow[]>(['templates'], '/templates');
  return (
    <>
      <PageHeader
        title="Email templates"
        description="Reusable emails with variables like {{customer.first_name}}. Automations and campaigns send these."
        actions={
          can('crm.templates') ? (
            <LinkButton href="/dealer/crm/templates/new" variant="default">
              <Plus className="h-4 w-4" aria-hidden /> New template
            </LinkButton>
          ) : null
        }
      />
      <DataTable<TemplateRow>
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            label: 'Template',
            render: (row) => (
              <Link
                href={`/dealer/crm/templates/${row.id}`}
                className="font-medium hover:underline"
              >
                {row.name}
              </Link>
            ),
          },
          {
            key: 'subject',
            label: 'Subject',
            render: (row) => <span className="text-sm text-muted-foreground">{row.subject}</span>,
          },
          { key: 'category', label: 'Category', render: (row) => humanize(row.category) },
          { key: 'kind', label: 'Kind', render: (row) => humanize(row.purpose) },
          {
            key: 'active',
            label: 'State',
            render: (row) => <StatusPill status={row.isActive ? 'ACTIVE' : 'STOPPED'} />,
          },
          { key: 'used', label: 'Sent', align: 'right', render: (row) => row._count.emails },
          {
            key: 'updated',
            label: 'Updated',
            render: (row) => `v${row.version} · ${dateTime(row.updatedAt)}`,
          },
        ]}
      />
    </>
  );
}
