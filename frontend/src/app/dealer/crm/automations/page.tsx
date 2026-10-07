'use client';

import { Plus } from 'lucide-react';
import { ErrorAlert, Spinner } from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import { AutomationList } from '@/components/crm/automation-list';
import { LinkButton, PageHeader, useCrmMutation, useCrmQuery } from '@/components/crm/ui';
import { crm, type AutomationRow } from '@/lib/crm';

export default function AutomationsPage() {
  const { can } = useCrm();
  const list = useCrmQuery<AutomationRow[]>(['automations'], '/automations');
  const toggle = useCrmMutation((automation: AutomationRow) =>
    crm.post(`/automations/${automation.id}/active`, { isActive: !automation.isActive }),
  );
  return (
    <>
      <PageHeader
        title="Automations"
        description="Follow-up sequences that run on their own: emails, tasks, waits and checks. They stop when the customer replies, buys, is lost or unsubscribes. Starting sequences are off until you turn them on."
        actions={
          can('crm.automations') ? (
            <LinkButton href="/dealer/crm/automations/new" variant="default">
              <Plus className="h-4 w-4" aria-hidden /> New automation
            </LinkButton>
          ) : null
        }
      />
      <ErrorAlert error={list.error ?? toggle.error} className="mb-3" />
      {list.isPending && !list.data ? <Spinner /> : null}
      <AutomationList
        automations={list.data}
        basePath="/dealer/crm/automations"
        canEdit={can('crm.automations')}
        onToggle={(automation) => toggle.mutate(automation)}
        busyId={toggle.isPending ? toggle.variables?.id : null}
      />
    </>
  );
}
