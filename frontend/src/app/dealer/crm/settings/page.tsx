'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import {
  ASSIGNMENT_MATCH_FIELDS,
  CRM_NOTIFICATION_LABELS,
  LEAD_STATUS_KINDS,
  SCORE_SIGNAL_LABELS,
  type CrmNotificationEvent,
  type ScoreSignal,
} from '@vintrax/shared';
import {
  Button,
  Card,
  CardContent,
  ErrorAlert,
  Field,
  Input,
  Pagination,
  Select,
} from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import {
  DataTable,
  PageHeader,
  Section,
  Tabs,
  fieldError,
  useCrmMutation,
  useCrmQuery,
} from '@/components/crm/ui';
import {
  crm,
  dateTime,
  dollars,
  humanize,
  personName,
  qs,
  type CrmSettings,
  type LeadSource,
  type LeadStatus,
  type Paged,
  type Tag,
} from '@/lib/crm';

type Tab =
  | 'GENERAL'
  | 'STATUSES'
  | 'SOURCES'
  | 'TAGS'
  | 'SCORING'
  | 'ASSIGNMENT'
  | 'NOTIFICATIONS'
  | 'SUPPRESSION'
  | 'AUDIT';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CrmSettingsPage() {
  const { can } = useCrm();
  const tabs: Array<{ id: Tab; label: string }> = [
    ...(can('crm.settings') ? ([{ id: 'GENERAL', label: 'General' }] as const) : []),
    { id: 'STATUSES', label: 'Statuses' },
    { id: 'SOURCES', label: 'Sources' },
    { id: 'TAGS', label: 'Tags' },
    { id: 'SCORING', label: 'Scoring' },
    ...(can('crm.settings') ? ([{ id: 'ASSIGNMENT', label: 'Assignment & teams' }] as const) : []),
    { id: 'NOTIFICATIONS', label: 'My notifications' },
    { id: 'SUPPRESSION', label: 'Suppression list' },
    ...(can('crm.manage') ? ([{ id: 'AUDIT', label: 'Audit log' }] as const) : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]!.id);
  return (
    <>
      <PageHeader
        title="CRM settings"
        description="How your CRM works: business hours, statuses, sources, scoring, assignment, consent and notifications."
      />
      <Tabs label="Settings" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'GENERAL' ? <General /> : null}
      {tab === 'STATUSES' ? <Statuses /> : null}
      {tab === 'SOURCES' ? <Sources /> : null}
      {tab === 'TAGS' ? <Tags /> : null}
      {tab === 'SCORING' ? <Scoring /> : null}
      {tab === 'ASSIGNMENT' ? <Assignment /> : null}
      {tab === 'NOTIFICATIONS' ? <Notifications /> : null}
      {tab === 'SUPPRESSION' ? <Suppression /> : null}
      {tab === 'AUDIT' ? <Audit /> : null}
    </>
  );
}

function General() {
  const { me } = useCrm();
  const [form, setForm] = useState<CrmSettings>(me.settings);
  useEffect(() => setForm(me.settings), [me.settings]);
  const save = useCrmMutation(() =>
    crm.put('/settings', {
      timezone: form.timezone,
      sendWindowStartHour: form.sendWindowStartHour,
      sendWindowEndHour: form.sendWindowEndHour,
      sendDays: form.sendDays,
      responseTargetMinutes: form.responseTargetMinutes,
      noResponseDays: form.noResponseDays,
      inactiveDays: form.inactiveDays,
      assignmentMode: form.assignmentMode,
      createFollowUpTask: form.createFollowUpTask,
      senderName: form.senderName,
      replyToEmail: form.replyToEmail,
      businessAddress: form.businessAddress,
      businessPhone: form.businessPhone,
      businessEmail: form.businessEmail,
      impliedConsentFromInquiry: form.impliedConsentFromInquiry,
      impliedConsentFromPurchase: form.impliedConsentFromPurchase,
      postSaleEnabled: form.postSaleEnabled,
    }),
  );
  const num = (key: keyof CrmSettings) => ({
    value: String(form[key] ?? ''),
    onChange: (event: { target: { value: string } }) =>
      setForm({ ...form, [key]: Number(event.target.value) }),
  });
  const text = (key: keyof CrmSettings) => ({
    value: (form[key] as string | null) ?? '',
    onChange: (event: { target: { value: string } }) =>
      setForm({ ...form, [key]: event.target.value || null }),
  });
  const error = save.error;
  return (
    <div className="space-y-6">
      <Section
        title="Business hours"
        description="Automated emails wait for these hours, in your time zone."
      >
        <Card>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-3">
            <Field label="Time zone" htmlFor="st-tz" error={fieldError(error, 'timezone')}>
              <Select
                id="st-tz"
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              >
                {[
                  'America/St_Johns',
                  'America/Halifax',
                  'America/Moncton',
                  'America/Toronto',
                  'America/Winnipeg',
                  'America/Regina',
                  'America/Edmonton',
                  'America/Vancouver',
                  'America/Whitehorse',
                ].map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace('America/', '').replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From (hour)" htmlFor="st-from">
              <Input id="st-from" type="number" min={0} max={23} {...num('sendWindowStartHour')} />
            </Field>
            <Field
              label="Until (hour)"
              htmlFor="st-to"
              error={fieldError(error, 'sendWindowEndHour')}
            >
              <Input id="st-to" type="number" min={1} max={24} {...num('sendWindowEndHour')} />
            </Field>
            <div className="sm:col-span-3">
              <p className="mb-1 text-sm font-medium">Sending days</p>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((day, index) => (
                  <label key={day} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.sendDays.includes(index)}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          sendDays: event.target.checked
                            ? [...form.sendDays, index].sort()
                            : form.sendDays.filter((value) => value !== index),
                        })
                      }
                    />
                    {day}
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </Section>
      <Section title="Follow-up targets">
        <Card>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-3">
            <Field label="First response target (minutes)" htmlFor="st-target">
              <Input id="st-target" type="number" min={1} {...num('responseTargetMinutes')} />
            </Field>
            <Field label="“No response” after (days)" htmlFor="st-noresp">
              <Input id="st-noresp" type="number" min={1} {...num('noResponseDays')} />
            </Field>
            <Field label="“Inactive” after (days)" htmlFor="st-inactive">
              <Input id="st-inactive" type="number" min={1} {...num('inactiveDays')} />
            </Field>
            <Field label="New leads go to" htmlFor="st-mode">
              <Select
                id="st-mode"
                value={form.assignmentMode}
                onChange={(event) =>
                  setForm({
                    ...form,
                    assignmentMode: event.target.value as CrmSettings['assignmentMode'],
                  })
                }
              >
                <option value="ROUND_ROBIN">Round-robin among salespeople</option>
                <option value="RULES">Assignment rules, then round-robin</option>
                <option value="MANUAL">Nobody (a manager assigns)</option>
              </Select>
            </Field>
            <label className="mt-6 flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.createFollowUpTask}
                onChange={(event) => setForm({ ...form, createFollowUpTask: event.target.checked })}
              />
              Give the salesperson a “first contact” task when a lead is assigned
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                checked={form.postSaleEnabled}
                onChange={(event) => setForm({ ...form, postSaleEnabled: event.target.checked })}
              />
              Start post-sale automations when a sale is posted in Accounting
            </label>
          </CardContent>
        </Card>
      </Section>
      <Section
        title="Sender identity"
        description="Shown at the foot of every email. Canada’s anti-spam law requires a mailing address on marketing email; campaigns are blocked until it is set."
      >
        <Card>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
            <Field label="Sender name" htmlFor="st-sender">
              <Input id="st-sender" placeholder={me.dealer.name} {...text('senderName')} />
            </Field>
            <Field
              label="Replies go to"
              htmlFor="st-reply"
              error={fieldError(error, 'replyToEmail')}
              hint="Empty: the salesperson’s own address."
            >
              <Input id="st-reply" type="email" {...text('replyToEmail')} />
            </Field>
            <Field label="Business mailing address" htmlFor="st-address" className="sm:col-span-2">
              <Input id="st-address" {...text('businessAddress')} />
            </Field>
            <Field
              label="Business phone"
              htmlFor="st-phone"
              error={fieldError(error, 'businessPhone')}
            >
              <Input id="st-phone" type="tel" {...text('businessPhone')} />
            </Field>
            <Field
              label="Business email"
              htmlFor="st-email"
              error={fieldError(error, 'businessEmail')}
            >
              <Input id="st-email" type="email" {...text('businessEmail')} />
            </Field>
          </CardContent>
        </Card>
      </Section>
      <Section
        title="Consent defaults (CASL)"
        description="Implied consent is recorded only when it actually arises, with its source and expiry. A lead entered by hand or imported has none unless you record it. This is not legal advice."
      >
        <Card>
          <CardContent className="space-y-2 pt-5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.impliedConsentFromInquiry}
                onChange={(event) =>
                  setForm({ ...form, impliedConsentFromInquiry: event.target.checked })
                }
              />
              Record implied consent when someone inquires through Vintrax (lasts 6 months)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.impliedConsentFromPurchase}
                onChange={(event) =>
                  setForm({ ...form, impliedConsentFromPurchase: event.target.checked })
                }
              />
              Record implied consent when someone buys a vehicle (lasts 2 years)
            </label>
          </CardContent>
        </Card>
      </Section>
      <ErrorAlert error={error} />
      <div className="flex items-center gap-3">
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Save settings
        </Button>
        {save.isSuccess ? <span className="text-sm text-success">Saved.</span> : null}
      </div>
    </div>
  );
}

function Statuses() {
  const { can } = useCrm();
  const list = useCrmQuery<LeadStatus[]>(['statuses'], '/statuses');
  const [draft, setDraft] = useState({ label: '', kind: 'OPEN' });
  const create = useCrmMutation(
    () => crm.post('/statuses', { ...draft, inPipeline: draft.kind === 'OPEN', isActive: true }),
    () => setDraft({ label: '', kind: 'OPEN' }),
  );
  const update = useCrmMutation((status: LeadStatus) =>
    crm.put(`/statuses/${status.id}`, {
      label: status.label,
      kind: status.kind,
      inPipeline: status.inPipeline,
      isActive: status.isActive,
    }),
  );
  const reorder = useCrmMutation((ids: string[]) => crm.put('/statuses/order', { ids }));
  const remove = useCrmMutation((id: string) => crm.delete(`/statuses/${id}`));
  const editable = can('crm.settings');
  const rows = list.data ?? [];
  const move = (index: number, direction: -1 | 1) => {
    const ids = rows.map((row) => row.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };
  return (
    <>
      <ErrorAlert
        error={list.error ?? create.error ?? update.error ?? reorder.error ?? remove.error}
        className="mb-3"
      />
      <DataTable<LeadStatus>
        rows={rows}
        loading={list.isPending}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'label',
            label: 'Status',
            render: (row) =>
              editable ? (
                <Input
                  aria-label="Label"
                  className="h-8"
                  defaultValue={row.label}
                  onBlur={(event) =>
                    event.target.value !== row.label &&
                    update.mutate({ ...row, label: event.target.value })
                  }
                />
              ) : (
                row.label
              ),
          },
          { key: 'kind', label: 'Means', render: (row) => humanize(row.kind) },
          {
            key: 'pipeline',
            label: 'On the board',
            render: (row) => (
              <input
                type="checkbox"
                aria-label="Show on the pipeline"
                disabled={!editable}
                checked={!!row.inPipeline}
                onChange={(event) => update.mutate({ ...row, inPipeline: event.target.checked })}
              />
            ),
          },
          {
            key: 'active',
            label: 'In use',
            render: (row) => (
              <input
                type="checkbox"
                aria-label="In use"
                disabled={!editable}
                checked={row.isActive !== false}
                onChange={(event) => update.mutate({ ...row, isActive: event.target.checked })}
              />
            ),
          },
          { key: 'leads', label: 'Leads', align: 'right', render: (row) => row._count?.leads ?? 0 },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (row) =>
              editable ? (
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move up"
                    onClick={() => move(rows.indexOf(row), -1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Move down"
                    onClick={() => move(rows.indexOf(row), 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${row.label}`}
                    onClick={() => remove.mutate(row.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />
      {editable ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="New status" htmlFor="ns-label">
            <Input
              id="ns-label"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </Field>
          <Field label="Means" htmlFor="ns-kind">
            <Select
              id="ns-kind"
              value={draft.kind}
              onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
            >
              {LEAD_STATUS_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {humanize(kind)}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            disabled={!draft.label.trim()}
            loading={create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            Add
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Sources() {
  const { can } = useCrm();
  const list = useCrmQuery<LeadSource[]>(['sources'], '/sources');
  const [label, setLabel] = useState('');
  const create = useCrmMutation(
    () => crm.post('/sources', { label, isActive: true }),
    () => setLabel(''),
  );
  const update = useCrmMutation(
    (input: { source: LeadSource; monthlyCost?: string; isActive?: boolean }) =>
      crm.put(`/sources/${input.source.id}`, {
        label: input.source.label,
        monthlyCost:
          input.monthlyCost ??
          (input.source.monthlyCostCents ? input.source.monthlyCostCents / 100 : null),
        isActive: input.isActive ?? input.source.isActive,
      }),
  );
  const editable = can('crm.settings');
  return (
    <>
      <ErrorAlert error={list.error ?? create.error ?? update.error} className="mb-3" />
      <DataTable<LeadSource>
        rows={list.data}
        loading={list.isPending}
        rowKey={(row) => row.id}
        columns={[
          { key: 'label', label: 'Source', render: (row) => row.label },
          {
            key: 'cost',
            label: 'Monthly cost',
            render: (row) =>
              editable ? (
                <Input
                  aria-label={`Monthly cost for ${row.label}`}
                  className="h-8 w-28"
                  inputMode="decimal"
                  defaultValue={row.monthlyCostCents ? String(row.monthlyCostCents / 100) : ''}
                  onBlur={(event) =>
                    update.mutate({ source: row, monthlyCost: event.target.value })
                  }
                />
              ) : (
                dollars(row.monthlyCostCents)
              ),
          },
          {
            key: 'active',
            label: 'In use',
            render: (row) => (
              <input
                type="checkbox"
                aria-label="In use"
                disabled={!editable}
                checked={row.isActive !== false}
                onChange={(event) => update.mutate({ source: row, isActive: event.target.checked })}
              />
            ),
          },
          { key: 'leads', label: 'Leads', align: 'right', render: (row) => row._count?.leads ?? 0 },
        ]}
      />
      {editable ? (
        <div className="mt-3 flex items-end gap-2">
          <Field label="New source" htmlFor="nsrc">
            <Input id="nsrc" value={label} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <Button
            disabled={!label.trim()}
            loading={create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            Add
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Tags() {
  const { can } = useCrm();
  const list = useCrmQuery<Tag[]>(['tags'], '/tags');
  const [name, setName] = useState('');
  const create = useCrmMutation(
    () => crm.post('/tags', { name, color: null }),
    () => setName(''),
  );
  const remove = useCrmMutation((id: string) => crm.delete(`/tags/${id}`));
  return (
    <>
      <ErrorAlert error={list.error ?? create.error ?? remove.error} className="mb-3" />
      <div className="flex flex-wrap gap-2">
        {list.data?.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm"
          >
            {tag.name}{' '}
            <span className="text-xs text-muted-foreground">{tag._count?.leads ?? 0}</span>
            {can('crm.manage') ? (
              <button
                type="button"
                aria-label={`Delete ${tag.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => remove.mutate(tag.id)}
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {can('crm.manage') ? (
        <div className="mt-4 flex items-end gap-2">
          <Field label="New tag" htmlFor="ntag">
            <Input id="ntag" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Button
            disabled={!name.trim()}
            loading={create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            Add
          </Button>
        </div>
      ) : null}
    </>
  );
}

interface ScoringView {
  rules: Array<{ signal: ScoreSignal; points: number; isActive: boolean }>;
  hotThreshold: number;
  warmThreshold: number;
}

function Scoring() {
  const { can } = useCrm();
  const data = useCrmQuery<ScoringView>(['scoring'], '/scoring');
  const [form, setForm] = useState<ScoringView | null>(null);
  useEffect(() => {
    if (data.data) setForm(data.data);
  }, [data.data]);
  const save = useCrmMutation(() => crm.put('/scoring', form));
  if (!form) return <ErrorAlert error={data.error} />;
  const editable = can('crm.settings');
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each signal adds or takes away points. The score sets the temperature: hot at or above the
        hot threshold, warm at or above warm, otherwise cold.
      </p>
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
          {form.rules.map((rule, index) => (
            <div key={rule.signal} className="flex items-center gap-3">
              <input
                type="checkbox"
                aria-label={`Use ${SCORE_SIGNAL_LABELS[rule.signal]}`}
                disabled={!editable}
                checked={rule.isActive}
                onChange={(event) =>
                  setForm({
                    ...form,
                    rules: form.rules.map((r, i) =>
                      i === index ? { ...r, isActive: event.target.checked } : r,
                    ),
                  })
                }
              />
              <label htmlFor={`sc-${rule.signal}`} className="flex-1 text-sm">
                {SCORE_SIGNAL_LABELS[rule.signal]}
              </label>
              <Input
                id={`sc-${rule.signal}`}
                type="number"
                className="h-8 w-20"
                disabled={!editable}
                value={rule.points}
                onChange={(event) =>
                  setForm({
                    ...form,
                    rules: form.rules.map((r, i) =>
                      i === index ? { ...r, points: Number(event.target.value) } : r,
                    ),
                  })
                }
              />
            </div>
          ))}
          <Field label="Hot at" htmlFor="sc-hot">
            <Input
              id="sc-hot"
              type="number"
              disabled={!editable}
              value={form.hotThreshold}
              onChange={(event) => setForm({ ...form, hotThreshold: Number(event.target.value) })}
            />
          </Field>
          <Field label="Warm at" htmlFor="sc-warm" error={fieldError(save.error, 'warmThreshold')}>
            <Input
              id="sc-warm"
              type="number"
              disabled={!editable}
              value={form.warmThreshold}
              onChange={(event) => setForm({ ...form, warmThreshold: Number(event.target.value) })}
            />
          </Field>
        </CardContent>
      </Card>
      <ErrorAlert error={save.error} />
      {editable ? (
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Save scoring
        </Button>
      ) : null}
    </div>
  );
}

interface AssignmentView {
  mode: string;
  rules: Array<{
    id: string;
    matchField: string;
    matchValue: string | null;
    assignToUserId: string | null;
    assignToTeam: string | null;
    isActive: boolean;
  }>;
  teams: Array<{ userId: string; team: string }>;
}

function Assignment() {
  const { me } = useCrm();
  const data = useCrmQuery<AssignmentView>(['assignment'], '/assignment');
  const [rule, setRule] = useState({
    matchField: 'SOURCE',
    matchValue: '',
    assignToUserId: '',
    assignToTeam: '',
  });
  const create = useCrmMutation(() =>
    crm.post('/assignment/rules', {
      ...rule,
      matchValue: rule.matchValue || null,
      assignToUserId: rule.assignToUserId || null,
      assignToTeam: rule.assignToTeam || null,
      isActive: true,
    }),
  );
  const remove = useCrmMutation((id: string) => crm.delete(`/assignment/rules/${id}`));
  const setTeam = useCrmMutation((input: { userId: string; team: string }) =>
    crm.put(`/teams/${input.userId}`, { team: input.team || null }),
  );
  const nameOf = (id: string | null) =>
    personName(me.staff.find((person) => person.id === id) ?? null);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Current mode: <strong>{humanize(data.data?.mode)}</strong> (change it under General). In
        rules mode the first matching rule wins; a rule naming a team hands leads round-robin within
        it.
      </p>
      <ErrorAlert error={data.error ?? create.error ?? remove.error ?? setTeam.error} />
      <Section title="Rules">
        <DataTable
          rows={data.data?.rules}
          loading={data.isPending}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'when',
              label: 'When',
              render: (row) =>
                row.matchField === 'ANY'
                  ? 'Any lead'
                  : `${humanize(row.matchField)} is ${row.matchValue}`,
            },
            {
              key: 'to',
              label: 'Assign to',
              render: (row) =>
                row.assignToUserId ? nameOf(row.assignToUserId) : `Team ${row.assignToTeam}`,
            },
            {
              key: 'x',
              label: '',
              align: 'right',
              render: (row) => (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Delete rule"
                  onClick={() => remove.mutate(row.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ),
            },
          ]}
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          <Select
            aria-label="Match on"
            value={rule.matchField}
            onChange={(event) => setRule({ ...rule, matchField: event.target.value })}
          >
            {ASSIGNMENT_MATCH_FIELDS.map((field) => (
              <option key={field} value={field}>
                {field === 'ANY' ? 'Any lead' : humanize(field)}
              </option>
            ))}
          </Select>
          {rule.matchField === 'SOURCE' ? (
            <Select
              aria-label="Source"
              value={rule.matchValue}
              onChange={(event) => setRule({ ...rule, matchValue: event.target.value })}
            >
              <option value="">Choose</option>
              {me.sources.map((source) => (
                <option key={source.id} value={source.key}>
                  {source.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              aria-label="Value"
              placeholder={
                rule.matchField === 'PROVINCE'
                  ? 'BC'
                  : rule.matchField === 'VEHICLE_MAKE'
                    ? 'Toyota'
                    : ''
              }
              disabled={rule.matchField === 'ANY'}
              value={rule.matchValue}
              onChange={(event) => setRule({ ...rule, matchValue: event.target.value })}
            />
          )}
          <Select
            aria-label="Salesperson"
            value={rule.assignToUserId}
            onChange={(event) => setRule({ ...rule, assignToUserId: event.target.value })}
          >
            <option value="">— or a team —</option>
            {me.staff.map((person) => (
              <option key={person.id} value={person.id}>
                {personName(person)}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Team"
            placeholder="Team name"
            value={rule.assignToTeam}
            onChange={(event) => setRule({ ...rule, assignToTeam: event.target.value })}
          />
          <Button loading={create.isPending} onClick={() => create.mutate(undefined)}>
            Add rule
          </Button>
        </div>
      </Section>
      <Section title="Teams">
        <DataTable
          rows={me.staff}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'name',
              label: 'Person',
              render: (row) => `${personName(row)} · ${row.roleLabel}`,
            },
            {
              key: 'team',
              label: 'Team',
              render: (row) => (
                <Input
                  aria-label={`Team for ${personName(row)}`}
                  className="h-8 w-40"
                  defaultValue={
                    data.data?.teams.find((entry) => entry.userId === row.id)?.team ?? ''
                  }
                  onBlur={(event) => setTeam.mutate({ userId: row.id, team: event.target.value })}
                />
              ),
            },
          ]}
        />
      </Section>
    </div>
  );
}

function Notifications() {
  const data = useCrmQuery<Array<{ event: CrmNotificationEvent; inApp: boolean; email: boolean }>>(
    ['notification-prefs'],
    '/notification-preferences',
  );
  const [prefs, setPrefs] = useState<
    Array<{ event: CrmNotificationEvent; inApp: boolean; email: boolean }>
  >([]);
  useEffect(() => {
    if (data.data) setPrefs(data.data);
  }, [data.data]);
  const save = useCrmMutation(() => crm.put('/notification-preferences', { preferences: prefs }));
  return (
    <div className="space-y-3">
      <DataTable
        rows={prefs}
        loading={data.isPending}
        error={data.error}
        rowKey={(row) => row.event}
        columns={[
          { key: 'event', label: 'When', render: (row) => CRM_NOTIFICATION_LABELS[row.event] },
          {
            key: 'app',
            label: 'In the app',
            render: (row) => (
              <input
                type="checkbox"
                aria-label="In the app"
                checked={row.inApp}
                onChange={(event) =>
                  setPrefs(
                    prefs.map((p) =>
                      p.event === row.event ? { ...p, inApp: event.target.checked } : p,
                    ),
                  )
                }
              />
            ),
          },
          {
            key: 'email',
            label: 'By email',
            render: (row) => (
              <input
                type="checkbox"
                aria-label="By email"
                checked={row.email}
                onChange={(event) =>
                  setPrefs(
                    prefs.map((p) =>
                      p.event === row.event ? { ...p, email: event.target.checked } : p,
                    ),
                  )
                }
              />
            ),
          },
        ]}
      />
      <ErrorAlert error={save.error} />
      <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
        Save preferences
      </Button>
      {save.isSuccess ? <span className="ml-3 text-sm text-success">Saved.</span> : null}
    </div>
  );
}

function Suppression() {
  const { can } = useCrm();
  const [q, setQ] = useState('');
  const list = useCrmQuery<
    Array<{
      id: string;
      dealerId: string | null;
      email: string;
      reason: string;
      source: string | null;
      createdAt: string;
    }>
  >(['suppressions', q], `/suppressions${qs({ q })}`);
  const [email, setEmail] = useState('');
  const add = useCrmMutation(
    () => crm.post('/suppressions', { email, note: null }),
    () => setEmail(''),
  );
  const remove = useCrmMutation((id: string) => crm.delete(`/suppressions/${id}`));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Addresses that receive nothing (bounced, invalid, blocked) or no marketing (unsubscribed).
        Platform-wide entries come from bounces and complaints and cannot be removed here.
      </p>
      <Input
        type="search"
        aria-label="Search"
        placeholder="Search an address"
        className="max-w-sm"
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      <ErrorAlert error={list.error ?? add.error ?? remove.error} />
      <DataTable
        rows={list.data}
        loading={list.isPending}
        rowKey={(row) => row.id}
        columns={[
          { key: 'email', label: 'Address', render: (row) => row.email },
          { key: 'reason', label: 'Reason', render: (row) => humanize(row.reason) },
          {
            key: 'scope',
            label: 'Applies to',
            render: (row) => (row.dealerId ? 'Your dealership' : 'All of Vintrax'),
          },
          {
            key: 'source',
            label: 'Source',
            render: (row) => <span className="text-xs">{row.source ?? '—'}</span>,
          },
          { key: 'when', label: 'Added', render: (row) => dateTime(row.createdAt) },
          {
            key: 'x',
            label: '',
            align: 'right',
            render: (row) =>
              row.dealerId && can('crm.manage') && row.reason === 'MANUAL' ? (
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(row.id)}>
                  Remove
                </Button>
              ) : null,
          },
        ]}
      />
      {can('crm.manage') ? (
        <div className="flex items-end gap-2">
          <Field label="Block an address from all email" htmlFor="sup-email">
            <Input
              id="sup-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Button disabled={!email} loading={add.isPending} onClick={() => add.mutate(undefined)}>
            Block
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const list = useCrmQuery<
    Paged<{
      id: string;
      action: string;
      entityType: string;
      entityId: string | null;
      actorEmail: string | null;
      after: unknown;
      createdAt: string;
    }>
  >(['audit', page], `/audit${qs({ page, pageSize: 50 })}`);
  return (
    <>
      <DataTable
        dense
        rows={list.data?.items}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          { key: 'when', label: 'When', render: (row) => dateTime(row.createdAt) },
          { key: 'who', label: 'Who', render: (row) => row.actorEmail ?? 'system' },
          { key: 'what', label: 'Action', render: (row) => row.action.replace(/[._]/g, ' ') },
          {
            key: 'detail',
            label: 'Detail',
            render: (row) => (
              <code className="block max-w-md truncate text-[11px]">
                {row.after ? JSON.stringify(row.after) : ''}
              </code>
            ),
          },
        ]}
      />
      <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onChange={setPage} />
    </>
  );
}
