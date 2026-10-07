'use client';

import Link from 'next/link';
import { AUTOMATION_STEP_LABELS, AUTOMATION_TRIGGER_LABELS, type AutomationStepType, type AutomationTrigger } from '@vintrax/shared';
import { Button, Card, CardContent, EmptyState } from '@/components/ui';
import type { AutomationRow } from '@/lib/crm';
import { StatusPill } from './ui';

/** Automations as cards: what starts them, their steps in words, how they are doing, and an on/off switch. */
export function AutomationList({
  automations,
  basePath,
  canEdit,
  onToggle,
  busyId,
}: {
  automations: AutomationRow[] | undefined;
  basePath: string;
  canEdit: boolean;
  onToggle: (automation: AutomationRow) => void;
  busyId?: string | null;
}) {
  if (automations && automations.length === 0) return <EmptyState title="No automations yet" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {automations?.map((automation) => (
        <Card key={automation.id}>
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`${basePath}/${automation.id}`} className="font-semibold hover:underline">{automation.name}</Link>
                <p className="text-xs text-muted-foreground">When {AUTOMATION_TRIGGER_LABELS[automation.trigger as AutomationTrigger]?.toLowerCase() ?? automation.trigger}</p>
              </div>
              <StatusPill status={automation.isActive ? 'ACTIVE' : 'STOPPED'} />
            </div>
            {automation.description ? <p className="text-sm text-muted-foreground">{automation.description}</p> : null}
            <p className="text-xs">
              {automation.steps.map((step) => AUTOMATION_STEP_LABELS[step.type as AutomationStepType]).join(' → ')}
            </p>
            {automation.stats ? (
              <p className="text-xs text-muted-foreground">
                {automation.stats.active} running · {automation.stats.completed} finished · {automation.stats.stopped} stopped
                {automation.stats.failed ? ` · ${automation.stats.failed} failed` : ''} · {automation.stats.emailsSent} emails · {automation.stats.replied} replies
              </p>
            ) : null}
            {canEdit ? (
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant={automation.isActive ? 'outline' : 'default'} loading={busyId === automation.id} onClick={() => onToggle(automation)}>
                  {automation.isActive ? 'Turn off' : 'Turn on'}
                </Button>
                <Link href={`${basePath}/${automation.id}`} className="inline-flex h-8 items-center rounded-md px-3 text-sm hover:bg-secondary">Edit</Link>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
