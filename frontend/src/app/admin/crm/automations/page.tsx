'use client';

import { Plus } from 'lucide-react';
import { ErrorAlert, Spinner } from '@/components/ui';
import { AutomationList } from '@/components/crm/automation-list';
import { LinkButton, PageHeader, useCrmMutation, useSupportQuery } from '@/components/crm/ui';
import { support, type AutomationRow } from '@/lib/crm';

export default function AdminCrmAutomationsPage() {
  const list = useSupportQuery<AutomationRow[]>(support, ['automations'], '/automations');
  const toggle = useCrmMutation(
    (automation: AutomationRow) =>
      support.post(`/automations/${automation.id}/active`, { isActive: !automation.isActive }),
    undefined,
    'support',
  );
  return (
    <>
      <PageHeader
        title="Support automations"
        description="Ticket confirmations, waiting reminders, satisfaction follow-ups and any sequence you build. They run against tickets."
        actions={
          <LinkButton href="/admin/crm/automations/new" variant="default">
            <Plus className="h-4 w-4" aria-hidden /> New automation
          </LinkButton>
        }
      />
      <ErrorAlert error={list.error ?? toggle.error} className="mb-3" />
      {list.isPending && !list.data ? <Spinner /> : null}
      <AutomationList
        automations={list.data}
        basePath="/admin/crm/automations"
        canEdit
        onToggle={(automation) => toggle.mutate(automation)}
        busyId={toggle.isPending ? toggle.variables?.id : null}
      />
    </>
  );
}
