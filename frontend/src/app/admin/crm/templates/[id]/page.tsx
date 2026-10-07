'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SUPPORT_TEMPLATE_VARIABLES } from '@vintrax/shared';
import { TemplateEditor } from '@/components/crm/template-editor';
import { PageHeader } from '@/components/crm/ui';
import { useUser } from '@/store/auth-store';
import { support } from '@/lib/crm';

export default function AdminCrmTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  return (
    <>
      <p className="mb-1 text-sm text-muted-foreground">
        <Link href="/admin/crm/templates" className="hover:underline">
          Templates
        </Link>
      </p>
      <PageHeader title={id === 'new' ? 'New support template' : 'Edit support template'} />
      <TemplateEditor
        api={support}
        id={id}
        queryKey={['support']}
        backHref="/admin/crm/templates"
        variables={SUPPORT_TEMPLATE_VARIABLES}
        canEdit
        allowMarketing={false}
        myEmail={user?.email ?? ''}
      />
    </>
  );
}
