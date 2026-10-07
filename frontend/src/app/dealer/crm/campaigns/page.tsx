'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CAMPAIGN_TYPES, LEAD_TEMPERATURES, PROVINCES, type CampaignType } from '@vintrax/shared';
import { Button, Dialog, ErrorAlert, Field, Input, Select } from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import {
  DataTable,
  PageHeader,
  StatusPill,
  useCrmMutation,
  useCrmQuery,
} from '@/components/crm/ui';
import { crm, dateTime, dollars, fromLocalInput, humanize, type TemplateRow } from '@/lib/crm';

interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: string;
  subject: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  recipientCount: number;
  skippedCount: number;
  costCents: number | null;
  template: { id: string; name: string } | null;
  stats: {
    total: number;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    failed: number;
  };
}

interface Audience {
  statusIds: string[];
  sourceIds: string[];
  tags: string[];
  provinces: string[];
  temperatures: string[];
  makes: string[];
  minBudget: string;
  maxBudget: string;
  customers: 'ANY' | 'ONLY' | 'EXCLUDE';
  activeAfter: string;
  inactiveSince: string;
}

const EMPTY: Audience = {
  statusIds: [],
  sourceIds: [],
  tags: [],
  provinces: [],
  temperatures: [],
  makes: [],
  minBudget: '',
  maxBudget: '',
  customers: 'ANY',
  activeAfter: '',
  inactiveSince: '',
};

interface AudiencePreview {
  matched: number;
  eligible: number;
  skipped: { noEmail: number; noConsent: number; suppressed: number; duplicateEmail: number };
  sample: Array<{ id: string; number: number; firstName: string; lastName: string | null }>;
}

/**
 * Marketing campaigns. They reach only leads with current consent and no
 * suppression; the audience preview shows who is skipped and why before
 * anything is sent.
 */
export default function CampaignsPage() {
  const list = useCrmQuery<Campaign[]>(['campaigns'], '/campaigns', true, 20_000);
  const [open, setOpen] = useState(false);
  const schedule = useCrmMutation((input: { id: string; at: string | null }) =>
    crm.post(`/campaigns/${input.id}/schedule`, { scheduledAt: input.at }),
  );
  const cancel = useCrmMutation((id: string) => crm.post(`/campaigns/${id}/cancel`));
  const remove = useCrmMutation((id: string) => crm.delete(`/campaigns/${id}`));
  const [when, setWhen] = useState<Record<string, string>>({});
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Marketing email to a filtered audience. Only leads with marketing consent receive it; every email carries your business identity and an unsubscribe link."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New campaign
          </Button>
        }
      />
      <ErrorAlert error={schedule.error ?? cancel.error ?? remove.error} className="mb-3" />
      <DataTable<Campaign>
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            label: 'Campaign',
            render: (row) => (
              <div>
                <span className="font-medium">{row.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {humanize(row.type)} · {row.template?.name ?? '—'}
                </span>
              </div>
            ),
          },
          { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
          {
            key: 'when',
            label: 'When',
            render: (row) => dateTime(row.completedAt ?? row.scheduledAt),
          },
          {
            key: 'reach',
            label: 'Sent / skipped',
            render: (row) => `${row.stats.sent} / ${row.skippedCount}`,
          },
          {
            key: 'results',
            label: 'Opened · clicked · unsubscribed',
            render: (row) =>
              `${row.stats.opened} · ${row.stats.clicked} · ${row.stats.unsubscribed}`,
          },
          { key: 'cost', label: 'Cost', align: 'right', render: (row) => dollars(row.costCents) },
          {
            key: 'actions',
            label: '',
            render: (row) =>
              row.status === 'DRAFT' ? (
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <Input
                    aria-label="Send at"
                    type="datetime-local"
                    className="h-8 w-48 text-xs"
                    value={when[row.id] ?? ''}
                    onChange={(event) => setWhen({ ...when, [row.id]: event.target.value })}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          when[row.id]
                            ? 'Schedule this campaign?'
                            : 'Send this campaign now to every consented lead in its audience?',
                        )
                      ) {
                        schedule.mutate({ id: row.id, at: fromLocalInput(when[row.id] ?? '') });
                      }
                    }}
                  >
                    {when[row.id] ? 'Schedule' : 'Send now'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(row.id)}>
                    Delete
                  </Button>
                </div>
              ) : row.status === 'SCHEDULED' || row.status === 'SENDING' ? (
                <Button size="sm" variant="ghost" onClick={() => cancel.mutate(row.id)}>
                  Cancel
                </Button>
              ) : null,
          },
        ]}
      />
      <CampaignDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function MultiSelect({
  label,
  id,
  options,
  value,
  onChange,
}: {
  label: string;
  id: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        multiple
        className="h-28 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
        value={value}
        onChange={(event) =>
          onChange(Array.from(event.target.selectedOptions).map((option) => option.value))
        }
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function CampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useCrm();
  const templates = useCrmQuery<TemplateRow[]>(['templates'], '/templates', open);
  const [name, setName] = useState('');
  const [type, setType] = useState<CampaignType>('NEW_INVENTORY');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [cost, setCost] = useState('');
  const [audience, setAudience] = useState<Audience>(EMPTY);
  const [makes, setMakes] = useState('');
  const [tags, setTags] = useState('');
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const body = () => ({
    ...audience,
    makes: makes
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    tags: tags
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    minBudget: audience.minBudget || null,
    maxBudget: audience.maxBudget || null,
    activeAfter: audience.activeAfter || null,
    inactiveSince: audience.inactiveSince || null,
  });
  const check = useCrmMutation(
    () => crm.post<AudiencePreview>('/campaigns/audience', body()),
    setPreview,
    'crm-preview',
  );
  const create = useCrmMutation(
    () =>
      crm.post('/campaigns', {
        name,
        type,
        templateId,
        subject: subject || null,
        audience: body(),
        scheduledAt: null,
        cost: cost || null,
      }),
    () => {
      onClose();
      setName('');
      setAudience(EMPTY);
      setPreview(null);
    },
  );
  const set =
    <K extends keyof Audience>(key: K) =>
    (value: Audience[K]) => {
      setAudience((current) => ({ ...current, [key]: value }));
      setPreview(null);
    };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New campaign"
      size="xl"
      footer={
        <>
          <Button
            variant="outline"
            loading={check.isPending}
            onClick={() => check.mutate(undefined)}
          >
            Check the audience
          </Button>
          <Button
            disabled={!name || !templateId}
            loading={create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            Save as draft
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor="cp-name">
          <Input id="cp-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Type" htmlFor="cp-type">
          <Select
            id="cp-type"
            value={type}
            onChange={(event) => setType(event.target.value as CampaignType)}
          >
            {CAMPAIGN_TYPES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Template" htmlFor="cp-template">
          <Select
            id="cp-template"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">Choose</option>
            {(templates.data ?? [])
              .filter((template) => template.isActive)
              .map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label="Subject (optional, overrides the template’s)"
          htmlFor="cp-subject"
          className="sm:col-span-2"
        >
          <Input
            id="cp-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </Field>
        <Field label="Cost ($, for reports)" htmlFor="cp-cost">
          <Input
            id="cp-cost"
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </Field>
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold">Audience</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <MultiSelect
          label="Lead status"
          id="cp-status"
          options={me.statuses.map((status) => ({ value: status.id, label: status.label }))}
          value={audience.statusIds}
          onChange={set('statusIds')}
        />
        <MultiSelect
          label="Source"
          id="cp-source"
          options={me.sources.map((source) => ({ value: source.id, label: source.label }))}
          value={audience.sourceIds}
          onChange={set('sourceIds')}
        />
        <MultiSelect
          label="Province"
          id="cp-province"
          options={PROVINCES.map((province) => ({ value: province, label: province }))}
          value={audience.provinces}
          onChange={set('provinces')}
        />
        <MultiSelect
          label="Temperature"
          id="cp-temp"
          options={LEAD_TEMPERATURES.map((value) => ({ value, label: humanize(value) }))}
          value={audience.temperatures}
          onChange={set('temperatures')}
        />
        <Field label="Vehicle brands (comma separated)" htmlFor="cp-makes">
          <Input
            id="cp-makes"
            value={makes}
            onChange={(event) => {
              setMakes(event.target.value);
              setPreview(null);
            }}
          />
        </Field>
        <Field label="Tags (comma separated)" htmlFor="cp-tags">
          <Input
            id="cp-tags"
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              setPreview(null);
            }}
          />
        </Field>
        <Field label="Budget from ($)" htmlFor="cp-min">
          <Input
            id="cp-min"
            inputMode="decimal"
            value={audience.minBudget}
            onChange={(event) => set('minBudget')(event.target.value)}
          />
        </Field>
        <Field label="Budget to ($)" htmlFor="cp-max">
          <Input
            id="cp-max"
            inputMode="decimal"
            value={audience.maxBudget}
            onChange={(event) => set('maxBudget')(event.target.value)}
          />
        </Field>
        <Field label="Customers" htmlFor="cp-customers">
          <Select
            id="cp-customers"
            value={audience.customers}
            onChange={(event) => set('customers')(event.target.value as Audience['customers'])}
          >
            <option value="ANY">Leads and customers</option>
            <option value="ONLY">Customers who bought</option>
            <option value="EXCLUDE">Leads who have not bought</option>
          </Select>
        </Field>
        <Field label="Active since" htmlFor="cp-active">
          <Input
            id="cp-active"
            type="date"
            value={audience.activeAfter}
            onChange={(event) => set('activeAfter')(event.target.value)}
          />
        </Field>
        <Field label="Quiet since" htmlFor="cp-quiet">
          <Input
            id="cp-quiet"
            type="date"
            value={audience.inactiveSince}
            onChange={(event) => set('inactiveSince')(event.target.value)}
          />
        </Field>
      </div>
      <ErrorAlert error={check.error ?? create.error} className="mt-3" />
      {preview ? (
        <div className="mt-4 rounded-md border border-border bg-secondary/30 p-3 text-sm">
          <p>
            <strong>{preview.eligible}</strong> of {preview.matched} matching leads can receive it.
            Skipped: {preview.skipped.noConsent} without consent, {preview.skipped.suppressed}{' '}
            unsubscribed or suppressed, {preview.skipped.noEmail} without email,{' '}
            {preview.skipped.duplicateEmail} sharing an address.
          </p>
          {preview.sample.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              For example:{' '}
              {preview.sample
                .slice(0, 8)
                .map((lead) => `${lead.firstName} ${lead.lastName ?? ''}`.trim())
                .join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
