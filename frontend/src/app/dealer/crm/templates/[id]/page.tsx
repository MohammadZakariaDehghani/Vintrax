'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DEALER_TEMPLATE_VARIABLES } from '@vintrax/shared';
import { useCrm } from '@/components/crm/context';
import { TemplateEditor } from '@/components/crm/template-editor';
import { PageHeader } from '@/components/crm/ui';
import { useUser } from '@/store/auth-store';
import { crm } from '@/lib/crm';

export default function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const { can, dealerId } = useCrm();
  const user = useUser();
  return (
    <>
      <p className="mb-1 text-sm text-muted-foreground">
        <Link href="/dealer/crm/templates" className="hover:underline">
          Templates
        </Link>
      </p>
      <PageHeader title={id === 'new' ? 'New template' : 'Edit template'} />
      <TemplateEditor
        api={crm}
        id={id}
        queryKey={['crm', dealerId]}
        backHref="/dealer/crm/templates"
        variables={DEALER_TEMPLATE_VARIABLES}
        canEdit={can('crm.templates')}
        allowMarketing
        myEmail={user?.email ?? ''}
      />
    </>
  );
}
