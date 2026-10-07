'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GitBranch, Plus, Trash2 } from 'lucide-react';
import {
  AUTOMATION_STEP_LABELS,
  AUTOMATION_STEP_TYPES,
  AUTOMATION_TRIGGER_LABELS,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  CRM_PRIORITIES,
  DEALER_TRIGGERS,
  STOP_CONDITIONS,
  SUPPORT_TRIGGERS,
  TICKET_STATUSES,
  type AutomationStepType,
} from '@vintrax/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
import {
  humanize,
  type AutomationRow,
  type AutomationStepView,
  type CrmClient,
  type TemplateRow,
} from '@/lib/crm';
import { StatusPill } from './ui';

type Scope = 'DEALER' | 'SUPPORT';
type Condition = { field: string; op: string; value?: unknown };

const DEALER_ONLY: AutomationStepType[] = [
  'MOVE_TO_NURTURE',
  'ADD_TAG',
  'REMOVE_TAG',
  'APPOINTMENT_REMINDER',
];
const STOP_LABELS: Record<string, string> = {
  REPLIED: 'The customer replies',
  WON: 'The lead is won',
  LOST: 'The lead is lost',
  APPOINTMENT_COMPLETED: 'An appointment is completed',
  UNSUBSCRIBED: 'They unsubscribe',
  EMAIL_INVALID: 'The email address bounces or is invalid',
  TICKET_CLOSED: 'The ticket is closed',
  USER_REPLIED: 'The requester replies',
};
const OP_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  contains: 'includes',
  is_true: 'is yes',
  is_false: 'is no',
};

function minutesLabel(minutes: number | undefined) {
  if (!minutes) return '—';
  if (minutes % 1440 === 0) return `${minutes / 1440} day(s)`;
  if (minutes % 60 === 0) return `${minutes / 60} hour(s)`;
  return `${minutes} min`;
}

/**
 * The automation builder for both CRMs: pick a trigger, then a list of steps
 * — waits, if/otherwise checks with a branch each way, and actions — and
 * what stops it. Steps run top to bottom unless a step says where to go.
 * The server validates the graph (no loops, no missing steps) before saving.
 */
export function AutomationBuilder({
  api,
  id,
  queryKey,
  backHref,
  scope,
  people,
  statuses,
  canEdit,
}: {
  api: CrmClient;
  id: string;
  queryKey: unknown[];
  backHref: string;
  scope: Scope;
  people: Array<{ id: string; name: string }>;
  statuses: Array<{ key: string; label: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const isNew = id === 'new';
  const automation = useQuery({
    queryKey: [...queryKey, 'automation', id],
    queryFn: () => api.get<AutomationRow>(`/automations/${id}`),
    enabled: !isNew,
  });
  const templates = useQuery({
    queryKey: [...queryKey, 'templates'],
    queryFn: () => api.get<TemplateRow[]>('/templates'),
  });
  const others = useQuery({
    queryKey: [...queryKey, 'automations'],
    queryFn: () => api.get<AutomationRow[]>('/automations'),
  });
  const triggers = scope === 'DEALER' ? DEALER_TRIGGERS : SUPPORT_TRIGGERS;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState<string>(triggers[0]);
  const [days, setDays] = useState('');
  const [statusKey, setStatusKey] = useState('');
  const [triggerConditions, setTriggerConditions] = useState<Condition[]>([]);
  const [steps, setSteps] = useState<AutomationStepView[]>([
    { id: 's1', type: 'SEND_EMAIL', next: null, config: {} },
  ]);
  const [stops, setStops] = useState<string[]>(
    scope === 'DEALER'
      ? ['REPLIED', 'WON', 'LOST', 'UNSUBSCRIBED', 'EMAIL_INVALID']
      : ['TICKET_CLOSED'],
  );
  const [respectSendWindow, setRespectSendWindow] = useState(scope === 'DEALER');
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const a = automation.data;
    if (!a) return;
    setName(a.name);
    setDescription(a.description ?? '');
    setTrigger(a.trigger);
    setDays(a.triggerConfig?.days ? String(a.triggerConfig.days) : '');
    setStatusKey(a.triggerConfig?.statusKey ?? '');
    setTriggerConditions(a.triggerConfig?.conditions ?? []);
    setSteps(a.steps);
    setStops(a.stopConditions);
    setRespectSendWindow(a.respectSendWindow);
    setIsActive(a.isActive);
  }, [automation.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        description: description || null,
        trigger,
        triggerConfig: {
          ...(days ? { days: Number(days) } : {}),
          ...(statusKey ? { statusKey } : {}),
          ...(triggerConditions.length ? { conditions: triggerConditions } : {}),
        },
        steps: steps.map((step) => ({
          ...step,
          next: step.type === 'CONDITION' || step.type === 'STOP' ? null : step.next || null,
        })),
        stopConditions: stops,
        respectSendWindow,
        isActive,
      };
      return isNew
        ? api.post<AutomationRow>('/automations', payload)
        : api.put<AutomationRow>(`/automations/${id}`, payload);
    },
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey: [queryKey[0]] });
      if (isNew) router.push(`${backHref}/${saved.id}`);
    },
  });

  if (!isNew && automation.isPending) return <Spinner />;
  if (automation.error) return <ErrorAlert error={automation.error} />;

  const ids = steps.map((step) => step.id);
  const nextId = () => {
    let n = steps.length + 1;
    while (ids.includes(`s${n}`)) n += 1;
    return `s${n}`;
  };
  const update = (index: number, patch: Partial<AutomationStepView>) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const updateConfig = (index: number, patch: Record<string, unknown>) =>
    setSteps((current) =>
      current.map((step, i) =>
        i === index ? { ...step, config: { ...step.config, ...patch } } : step,
      ),
    );
  const add = () => {
    const id = nextId();
    setSteps((current) => {
      const last = current[current.length - 1];
      const linked =
        last && last.type !== 'CONDITION' && last.type !== 'STOP' && !last.next
          ? current.map((step, i) => (i === current.length - 1 ? { ...step, next: id } : step))
          : current;
      return [...linked, { id, type: 'WAIT', next: null, config: { minutes: 1440 } }];
    });
  };
  const remove = (index: number) => {
    const removed = steps[index]!.id;
    setSteps((current) =>
      current
        .filter((_, i) => i !== index)
        .map((step) => ({
          ...step,
          next: step.next === removed ? null : step.next,
          yes: step.yes === removed ? null : step.yes,
          no: step.no === removed ? null : step.no,
        })),
    );
  };
  const move = (index: number, direction: -1 | 1) =>
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target]!, copy[index]!];
      return copy;
    });
  const linkInOrder = () =>
    setSteps((current) =>
      current.map((step, i) =>
        step.type === 'CONDITION' || step.type === 'STOP'
          ? step
          : { ...step, next: current[i + 1]?.id ?? null },
      ),
    );
  const stepLabel = (stepId: string | null | undefined) => {
    if (!stepId) return 'End';
    const index = steps.findIndex((step) => step.id === stepId);
    return index === -1
      ? 'End'
      : `Step ${index + 1}: ${AUTOMATION_STEP_LABELS[steps[index]!.type as AutomationStepType]}`;
  };
  const target = (
    value: string | null | undefined,
    onChange: (next: string | null) => void,
    label: string,
    htmlId: string,
    selfId: string,
  ) => (
    <Field label={label} htmlFor={htmlId}>
      <Select
        id={htmlId}
        disabled={!canEdit}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">End the automation</option>
        {steps
          .filter((step) => step.id !== selfId)
          .map((step) => (
            <option key={step.id} value={step.id}>
              {stepLabel(step.id)}
            </option>
          ))}
      </Select>
    </Field>
  );
  const templateOptions = (templates.data ?? []).filter((template) => template.isActive);
  const templateValue = (config: Record<string, unknown>) =>
    (config.templateId as string | undefined) ??
    templateOptions.find((template) => template.key === config.templateKey)?.id ??
    '';

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="au-name" className="sm:col-span-2">
            <Input
              id="au-name"
              disabled={!canEdit}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="What it is for" htmlFor="au-description" className="sm:col-span-2">
            <Input
              id="au-description"
              disabled={!canEdit}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Starts when" htmlFor="au-trigger">
            <Select
              id="au-trigger"
              disabled={!canEdit}
              value={trigger}
              onChange={(event) => setTrigger(event.target.value)}
            >
              {triggers.map((value) => (
                <option key={value} value={value}>
                  {AUTOMATION_TRIGGER_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          {['NO_RESPONSE', 'CUSTOMER_INACTIVE', 'TICKET_WAITING'].includes(trigger) ? (
            <Field label="After how many days" htmlFor="au-days">
              <Input
                id="au-days"
                type="number"
                min={1}
                disabled={!canEdit}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </Field>
          ) : null}
          {trigger === 'LEAD_STATUS_CHANGED' ? (
            <Field label="Into status" htmlFor="au-status">
              <Select
                id="au-status"
                disabled={!canEdit}
                value={statusKey}
                onChange={(event) => setStatusKey(event.target.value)}
              >
                <option value="">Any status</option>
                {statuses.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Only when (optional)</p>
            <ConditionsEditor
              scope={scope}
              conditions={triggerConditions}
              onChange={setTriggerConditions}
              disabled={!canEdit}
              idPrefix="tc"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Steps</h2>
        {canEdit ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={linkInOrder}>
              Link steps in order
            </Button>
            <Button size="sm" onClick={add}>
              <Plus className="h-4 w-4" aria-hidden /> Add step
            </Button>
          </div>
        ) : null}
      </div>
      <ol className="space-y-3">
        {steps.map((step, index) => {
          const type = step.type as AutomationStepType;
          const config = step.config as Record<string, unknown>;
          const htmlId = `step-${step.id}`;
          return (
            <li key={step.id}>
              <Card className={type === 'CONDITION' ? 'border-warning/60' : undefined}>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Step {index + 1}</Badge>
                      {type === 'CONDITION' ? (
                        <GitBranch className="h-4 w-4 text-warning" aria-hidden />
                      ) : null}
                      <Select
                        aria-label={`Step ${index + 1} type`}
                        className="h-9 w-56"
                        disabled={!canEdit}
                        value={type}
                        onChange={(event) =>
                          update(index, {
                            type: event.target.value,
                            config: event.target.value === 'WAIT' ? { minutes: 1440 } : {},
                          })
                        }
                      >
                        {AUTOMATION_STEP_TYPES.filter(
                          (value) => scope === 'DEALER' || !DEALER_ONLY.includes(value),
                        ).map((value) => (
                          <option key={value} value={value}>
                            {AUTOMATION_STEP_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {canEdit ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Move up"
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Move down"
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remove step"
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {type === 'WAIT' ? (
                      <Field
                        label="Wait"
                        htmlFor={`${htmlId}-wait`}
                        hint={minutesLabel(config.minutes as number)}
                      >
                        <div className="flex gap-2">
                          <Input
                            id={`${htmlId}-wait`}
                            type="number"
                            min={1}
                            disabled={!canEdit}
                            value={
                              (config.minutes as number) % 1440 === 0
                                ? (config.minutes as number) / 1440
                                : (config.minutes as number) % 60 === 0
                                  ? (config.minutes as number) / 60
                                  : ((config.minutes as number) ?? '')
                            }
                            onChange={(event) => {
                              const unit =
                                (config.minutes as number) % 1440 === 0
                                  ? 1440
                                  : (config.minutes as number) % 60 === 0
                                    ? 60
                                    : 1;
                              updateConfig(index, {
                                minutes: Math.max(1, Number(event.target.value) || 1) * unit,
                              });
                            }}
                          />
                          <Select
                            aria-label="Unit"
                            disabled={!canEdit}
                            value={
                              (config.minutes as number) % 1440 === 0
                                ? '1440'
                                : (config.minutes as number) % 60 === 0
                                  ? '60'
                                  : '1'
                            }
                            onChange={(event) => {
                              const current = config.minutes as number;
                              const amount =
                                current % 1440 === 0
                                  ? current / 1440
                                  : current % 60 === 0
                                    ? current / 60
                                    : current;
                              updateConfig(index, { minutes: amount * Number(event.target.value) });
                            }}
                          >
                            <option value="1">minutes</option>
                            <option value="60">hours</option>
                            <option value="1440">days</option>
                          </Select>
                        </div>
                      </Field>
                    ) : null}

                    {type === 'CONDITION' ? (
                      <div className="sm:col-span-2">
                        <p className="mb-1 text-sm font-medium">If all of these are true</p>
                        <ConditionsEditor
                          scope={scope}
                          conditions={(config.conditions as Condition[]) ?? []}
                          onChange={(conditions) => updateConfig(index, { conditions })}
                          disabled={!canEdit}
                          idPrefix={htmlId}
                        />
                      </div>
                    ) : null}

                    {type === 'SEND_EMAIL' || type === 'APPOINTMENT_REMINDER' ? (
                      <Field label="Email template" htmlFor={`${htmlId}-template`}>
                        <Select
                          id={`${htmlId}-template`}
                          disabled={!canEdit}
                          value={templateValue(config)}
                          onChange={(event) =>
                            updateConfig(index, {
                              templateId: event.target.value || undefined,
                              templateKey: undefined,
                            })
                          }
                        >
                          <option value="">Choose a template</option>
                          {templateOptions.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                              {template.purpose === 'MARKETING' ? ' (marketing)' : ''}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    {type === 'SEND_EMAIL' && scope === 'DEALER' ? (
                      <label className="mt-6 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={!!config.toSalesperson}
                          onChange={(event) =>
                            updateConfig(index, {
                              toSalesperson: event.target.checked || undefined,
                            })
                          }
                        />{' '}
                        Send to the salesperson instead
                      </label>
                    ) : null}
                    {type === 'APPOINTMENT_REMINDER' ? (
                      <Field
                        label="Minutes before (empty: the appointment’s own reminder)"
                        htmlFor={`${htmlId}-before`}
                      >
                        <Input
                          id={`${htmlId}-before`}
                          type="number"
                          min={0}
                          disabled={!canEdit}
                          value={(config.minutes as number | undefined) ?? ''}
                          onChange={(event) =>
                            updateConfig(index, {
                              minutes: event.target.value ? Number(event.target.value) : undefined,
                            })
                          }
                        />
                      </Field>
                    ) : null}

                    {type === 'CREATE_TASK' || type === 'NOTIFY' ? (
                      <>
                        <Field label="Title" htmlFor={`${htmlId}-title`}>
                          <Input
                            id={`${htmlId}-title`}
                            disabled={!canEdit}
                            value={(config.title as string) ?? ''}
                            onChange={(event) => updateConfig(index, { title: event.target.value })}
                          />
                        </Field>
                        <Field label="Details" htmlFor={`${htmlId}-body`}>
                          <Input
                            id={`${htmlId}-body`}
                            disabled={!canEdit}
                            value={(config.body as string) ?? ''}
                            onChange={(event) =>
                              updateConfig(index, { body: event.target.value || undefined })
                            }
                          />
                        </Field>
                      </>
                    ) : null}
                    {type === 'CREATE_TASK' ? (
                      <>
                        <Field label="Due in (hours)" htmlFor={`${htmlId}-due`}>
                          <Input
                            id={`${htmlId}-due`}
                            type="number"
                            min={0}
                            disabled={!canEdit}
                            value={
                              config.dueInMinutes !== undefined
                                ? Number(config.dueInMinutes) / 60
                                : ''
                            }
                            onChange={(event) =>
                              updateConfig(index, {
                                dueInMinutes:
                                  event.target.value === ''
                                    ? undefined
                                    : Math.round(Number(event.target.value) * 60),
                              })
                            }
                          />
                        </Field>
                        <Field label="Priority" htmlFor={`${htmlId}-priority`}>
                          <Select
                            id={`${htmlId}-priority`}
                            disabled={!canEdit}
                            value={(config.priority as string) ?? 'MEDIUM'}
                            onChange={(event) =>
                              updateConfig(index, { priority: event.target.value })
                            }
                          >
                            {CRM_PRIORITIES.map((priority) => (
                              <option key={priority} value={priority}>
                                {humanize(priority)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </>
                    ) : null}
                    {type === 'NOTIFY' ? (
                      <Field label="Who" htmlFor={`${htmlId}-who`}>
                        <Select
                          id={`${htmlId}-who`}
                          disabled={!canEdit}
                          value={(config.recipients as string) ?? 'ASSIGNEE'}
                          onChange={(event) =>
                            updateConfig(index, { recipients: event.target.value })
                          }
                        >
                          <option value="ASSIGNEE">
                            {scope === 'DEALER' ? 'The salesperson' : 'The assigned admin'}
                          </option>
                          <option value={scope === 'DEALER' ? 'MANAGERS' : 'TEAM'}>
                            {scope === 'DEALER' ? 'The owner and managers' : 'The team'}
                          </option>
                        </Select>
                      </Field>
                    ) : null}

                    {type === 'ASSIGN' ? (
                      <Field label="Assign to" htmlFor={`${htmlId}-assign`}>
                        <Select
                          id={`${htmlId}-assign`}
                          disabled={!canEdit}
                          value={(config.userId as string) ?? ''}
                          onChange={(event) =>
                            updateConfig(index, { userId: event.target.value || undefined })
                          }
                        >
                          <option value="">Automatically (rules / round-robin)</option>
                          {people.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}

                    {type === 'SET_STATUS' && scope === 'DEALER' ? (
                      <Field label="New status" htmlFor={`${htmlId}-status`}>
                        <Select
                          id={`${htmlId}-status`}
                          disabled={!canEdit}
                          value={(config.statusKey as string) ?? ''}
                          onChange={(event) =>
                            updateConfig(index, { statusKey: event.target.value })
                          }
                        >
                          <option value="">Choose</option>
                          {statuses.map((status) => (
                            <option key={status.key} value={status.key}>
                              {status.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    {type === 'SET_STATUS' && scope === 'SUPPORT' ? (
                      <Field label="New ticket status" htmlFor={`${htmlId}-tstatus`}>
                        <Select
                          id={`${htmlId}-tstatus`}
                          disabled={!canEdit}
                          value={(config.ticketStatus as string) ?? ''}
                          onChange={(event) =>
                            updateConfig(index, { ticketStatus: event.target.value })
                          }
                        >
                          <option value="">Choose</option>
                          {TICKET_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {humanize(status)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}

                    {type === 'ADD_TAG' || type === 'REMOVE_TAG' ? (
                      <Field label="Tag" htmlFor={`${htmlId}-tag`}>
                        <Input
                          id={`${htmlId}-tag`}
                          disabled={!canEdit}
                          value={(config.tag as string) ?? ''}
                          onChange={(event) => updateConfig(index, { tag: event.target.value })}
                        />
                      </Field>
                    ) : null}

                    {type === 'START_AUTOMATION' ? (
                      <Field label="Automation" htmlFor={`${htmlId}-auto`}>
                        <Select
                          id={`${htmlId}-auto`}
                          disabled={!canEdit}
                          value={
                            (config.automationId as string) ??
                            (others.data ?? []).find((a) => a.key === config.automationKey)?.id ??
                            ''
                          }
                          onChange={(event) =>
                            updateConfig(index, {
                              automationId: event.target.value || undefined,
                              automationKey: undefined,
                            })
                          }
                        >
                          <option value="">Choose</option>
                          {(others.data ?? [])
                            .filter((other) => other.id !== id)
                            .map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.name}
                              </option>
                            ))}
                        </Select>
                      </Field>
                    ) : null}

                    {type === 'CONDITION' ? (
                      <>
                        {target(
                          step.yes,
                          (value) => update(index, { yes: value }),
                          'If yes, go to',
                          `${htmlId}-yes`,
                          step.id,
                        )}
                        {target(
                          step.no,
                          (value) => update(index, { no: value }),
                          'Otherwise, go to',
                          `${htmlId}-no`,
                          step.id,
                        )}
                      </>
                    ) : type !== 'STOP' ? (
                      target(
                        step.next,
                        (value) => update(index, { next: value }),
                        'Then',
                        `${htmlId}-next`,
                        step.id,
                      )
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <h2 className="text-base font-semibold">Stop automatically when</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {STOP_CONDITIONS.filter((stop) =>
              scope === 'DEALER'
                ? !['TICKET_CLOSED', 'USER_REPLIED'].includes(stop)
                : ['TICKET_CLOSED', 'USER_REPLIED'].includes(stop),
            ).map((stop) => (
              <label key={stop} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={stops.includes(stop)}
                  onChange={(event) =>
                    setStops((current) =>
                      event.target.checked
                        ? [...current, stop]
                        : current.filter((value) => value !== stop),
                    )
                  }
                />
                {STOP_LABELS[stop]}
              </label>
            ))}
          </div>
          {scope === 'DEALER' ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={respectSendWindow}
                onChange={(event) => setRespectSendWindow(event.target.checked)}
              />
              Send emails only during business hours (CRM → Settings)
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            On — start it for every new trigger
          </label>
        </CardContent>
      </Card>

      <ErrorAlert error={save.error} />
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Save automation
          </Button>
          {save.isSuccess ? <span className="text-sm text-success">Saved.</span> : null}
          {automation.data ? (
            <StatusPill status={automation.data.isActive ? 'ACTIVE' : 'STOPPED'} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConditionsEditor({
  scope,
  conditions,
  onChange,
  disabled,
  idPrefix,
}: {
  scope: Scope;
  conditions: Condition[];
  onChange: (next: Condition[]) => void;
  disabled: boolean;
  idPrefix: string;
}) {
  const fields = CONDITION_FIELDS.filter((field) =>
    scope === 'DEALER' ? !field.startsWith('ticket.') : field.startsWith('ticket.'),
  );
  return (
    <div className="space-y-2">
      {conditions.map((condition, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Field"
            id={`${idPrefix}-f${index}`}
            className="h-9 w-48"
            disabled={disabled}
            value={condition.field}
            onChange={(event) =>
              onChange(
                conditions.map((c, i) => (i === index ? { ...c, field: event.target.value } : c)),
              )
            }
          >
            {fields.map((field) => (
              <option key={field} value={field}>
                {field.replace('.', ': ').replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Comparison"
            className="h-9 w-36"
            disabled={disabled}
            value={condition.op}
            onChange={(event) =>
              onChange(
                conditions.map((c, i) => (i === index ? { ...c, op: event.target.value } : c)),
              )
            }
          >
            {CONDITION_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {OP_LABELS[op]}
              </option>
            ))}
          </Select>
          {condition.op !== 'is_true' && condition.op !== 'is_false' ? (
            <Input
              aria-label="Value"
              className="h-9 w-44"
              disabled={disabled}
              value={
                Array.isArray(condition.value)
                  ? condition.value.join(',')
                  : String(condition.value ?? '')
              }
              onChange={(event) =>
                onChange(
                  conditions.map((c, i) =>
                    i === index
                      ? {
                          ...c,
                          value:
                            ['gt', 'gte', 'lt', 'lte'].includes(c.op) &&
                            event.target.value !== '' &&
                            !Number.isNaN(Number(event.target.value))
                              ? Number(event.target.value)
                              : event.target.value,
                        }
                      : c,
                  ),
                )
              }
            />
          ) : null}
          {!disabled ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remove condition"
              onClick={() => onChange(conditions.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
      {!disabled ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...conditions, { field: fields[0]!, op: 'eq', value: '' }])}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add a condition
        </Button>
      ) : null}
      {conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No conditions.</p>
      ) : null}
    </div>
  );
}
