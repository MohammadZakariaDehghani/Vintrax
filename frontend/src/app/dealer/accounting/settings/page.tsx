'use client';

import { useEffect, useState } from 'react';
import {
  DEALER_STAFF_ROLES,
  DEALER_STAFF_ROLE_LABELS,
  PROVINCES,
  PROVINCE_LABELS,
  TAX_FILING_FREQUENCIES,
  type DealerStaffRole,
} from '@vintrax/shared';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  ErrorAlert,
  Field,
  Input,
  Pagination,
  Select,
} from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { BankSelect } from '@/components/accounting/pickers';
import {
  DataTable,
  PageHeader,
  Section,
  fieldError,
  useAcctMutation,
  useAcctQuery,
} from '@/components/accounting/ui';
import { acct, isoDate, qs, type AccountingSettingsView, type Paged } from '@/lib/accounting';
import { formatEnum } from '@/lib/utils';

interface Member {
  id: string | null;
  userId: string;
  name: string;
  email: string;
  role: DealerStaffRole;
  permissions: string[];
}

interface AuditRow {
  id: string;
  at: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
}

const ROLE_HINTS: Record<DealerStaffRole, string> = {
  OWNER: 'Everything, including the team.',
  MANAGER: 'Runs the books; cannot reopen closed periods or manage the team.',
  ACCOUNTANT: 'Everything but the team, including reopening periods.',
  SALES_MANAGER:
    'The deal desk: customers, deposits, trade-ins, and posting sales. No financial reports.',
  SALES_USER: 'The deal desk only: quotes and draft deals. No financial reports.',
};

export default function SettingsPage() {
  const { can } = useAccounting();
  return (
    <>
      <PageHeader
        title="Settings and team"
        description="Your dealership's accounting settings, who can do what, and the audit trail."
      />
      {can('accounting.settings') ? <SettingsForm /> : null}
      {can('accounting.manage_team') ? <Team /> : null}
      {can('accounting.view') ? <AuditTrail /> : null}
    </>
  );
}

function SettingsForm() {
  const settings = useAcctQuery<AccountingSettingsView>(['settings'], '/settings');
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  useEffect(() => {
    if (!settings.data) return;
    const data = settings.data;
    setForm({
      legalName: data.legalName,
      businessNumber: data.businessNumber ?? '',
      gstHstNumber: data.gstHstNumber ?? '',
      pstNumber: data.pstNumber ?? '',
      qstNumber: data.qstNumber ?? '',
      province: data.province,
      fiscalYearStartMonth: String(data.fiscalYearStartMonth),
      fiscalYearStartDay: String(data.fiscalYearStartDay),
      taxFilingFrequency: data.taxFilingFrequency,
      defaultBankAccountId: data.defaultBankAccountId ?? '',
      invoicePrefix: data.invoicePrefix,
      journalPrefix: data.journalPrefix,
      allowNegativeInventory: data.allowNegativeInventory,
    });
  }, [settings.data]);
  const save = useAcctMutation(() =>
    acct.patch('/settings', {
      ...form,
      businessNumber: form['businessNumber'] || null,
      gstHstNumber: form['gstHstNumber'] || null,
      pstNumber: form['pstNumber'] || null,
      qstNumber: form['qstNumber'] || null,
      defaultBankAccountId: form['defaultBankAccountId'] || null,
      fiscalYearStartMonth: Number(form['fiscalYearStartMonth']),
      fiscalYearStartDay: Number(form['fiscalYearStartDay']),
    }),
  );
  const text = (key: string) => String(form[key] ?? '');
  const set = (key: string) => (value: string | boolean) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  if (!settings.data) return <ErrorAlert error={settings.error} />;
  return (
    <Section
      title="Accounting settings"
      description={`Set up on ${isoDate(settings.data.setUpOn)}. The fiscal calendar cannot change once anything is posted.`}
    >
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-3">
          <Field
            label="Legal name"
            htmlFor="st-legal"
            className="sm:col-span-2"
            error={fieldError(save.error, 'legalName')}
          >
            <Input
              id="st-legal"
              value={text('legalName')}
              onChange={(event) => set('legalName')(event.target.value)}
            />
          </Field>
          <Field label="Province" htmlFor="st-province">
            <Select
              id="st-province"
              value={text('province')}
              onChange={(event) => set('province')(event.target.value)}
            >
              {PROVINCES.map((province) => (
                <option key={province} value={province}>
                  {PROVINCE_LABELS[province]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Business number" htmlFor="st-bn">
            <Input
              id="st-bn"
              value={text('businessNumber')}
              onChange={(event) => set('businessNumber')(event.target.value)}
            />
          </Field>
          <Field label="GST/HST number" htmlFor="st-gst">
            <Input
              id="st-gst"
              value={text('gstHstNumber')}
              onChange={(event) => set('gstHstNumber')(event.target.value)}
            />
          </Field>
          <Field label="PST / RST number" htmlFor="st-pst">
            <Input
              id="st-pst"
              value={text('pstNumber')}
              onChange={(event) => set('pstNumber')(event.target.value)}
            />
          </Field>
          <Field label="QST number" htmlFor="st-qst">
            <Input
              id="st-qst"
              value={text('qstNumber')}
              onChange={(event) => set('qstNumber')(event.target.value)}
            />
          </Field>
          <Field
            label="Fiscal year start month"
            htmlFor="st-fym"
            error={fieldError(save.error, 'fiscalYearStartMonth')}
          >
            <Input
              id="st-fym"
              type="number"
              min={1}
              max={12}
              value={text('fiscalYearStartMonth')}
              onChange={(event) => set('fiscalYearStartMonth')(event.target.value)}
            />
          </Field>
          <Field label="Start day" htmlFor="st-fyd">
            <Input
              id="st-fyd"
              type="number"
              min={1}
              max={28}
              value={text('fiscalYearStartDay')}
              onChange={(event) => set('fiscalYearStartDay')(event.target.value)}
            />
          </Field>
          <Field label="Sales tax filing" htmlFor="st-freq">
            <Select
              id="st-freq"
              value={text('taxFilingFrequency')}
              onChange={(event) => set('taxFilingFrequency')(event.target.value)}
            >
              {TAX_FILING_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {formatEnum(frequency)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default bank account" htmlFor="st-bank">
            <BankSelect
              id="st-bank"
              value={text('defaultBankAccountId')}
              onChange={set('defaultBankAccountId')}
              placeholder="None"
            />
          </Field>
          <Field label="Invoice prefix" htmlFor="st-inv">
            <Input
              id="st-inv"
              maxLength={10}
              value={text('invoicePrefix')}
              onChange={(event) => set('invoicePrefix')(event.target.value)}
            />
          </Field>
          <Field label="Journal prefix" htmlFor="st-je">
            <Input
              id="st-je"
              maxLength={10}
              value={text('journalPrefix')}
              onChange={(event) => set('journalPrefix')(event.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              checked={Boolean(form['allowNegativeInventory'])}
              onChange={(event) => set('allowNegativeInventory')(event.target.checked)}
            />
            Allow selling a vehicle with no recorded purchase (its cost of sale will be zero — not
            recommended)
          </label>
          <div className="flex items-center justify-end gap-3 sm:col-span-3">
            {save.isSuccess ? <span className="text-sm text-success">Saved</span> : null}
            <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
              Save settings
            </Button>
          </div>
          <ErrorAlert error={save.error} className="sm:col-span-3" />
        </CardContent>
      </Card>
    </Section>
  );
}

function Team() {
  const team = useAcctQuery<Member[]>(['team'], '/team');
  const [adding, setAdding] = useState(false);
  const change = useAcctMutation(({ id, role }: { id: string; role: DealerStaffRole }) =>
    acct.patch(`/team/${id}`, { role }),
  );
  const remove = useAcctMutation((id: string) => acct.delete(`/team/${id}`));
  return (
    <Section
      title="Team"
      description="Staff sign in with their own Vintrax account. A salesperson never sees financial statements."
      actions={<Button onClick={() => setAdding(true)}>Add a team member</Button>}
    >
      <ErrorAlert error={change.error ?? remove.error} className="mb-2" />
      <DataTable
        loading={team.isPending}
        error={team.error}
        rows={team.data}
        rowKey={(row) => row.userId}
        columns={[
          {
            key: 'name',
            label: 'Name',
            render: (row) => (
              <>
                {row.name}
                <span className="block text-xs text-muted-foreground">{row.email}</span>
              </>
            ),
          },
          {
            key: 'role',
            label: 'Role',
            render: (row) =>
              row.id ? (
                <Select
                  aria-label={`Role for ${row.name}`}
                  className="h-9 w-48"
                  value={row.role}
                  onChange={(event) =>
                    change.mutate({ id: row.id!, role: event.target.value as DealerStaffRole })
                  }
                >
                  {DEALER_STAFF_ROLES.filter((role) => role !== 'OWNER').map((role) => (
                    <option key={role} value={role}>
                      {DEALER_STAFF_ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              ) : (
                DEALER_STAFF_ROLE_LABELS.OWNER
              ),
          },
          {
            key: 'can',
            label: 'Can',
            render: (row) => (
              <span className="text-xs text-muted-foreground">{ROLE_HINTS[row.role]}</span>
            ),
          },
          {
            key: 'remove',
            label: '',
            align: 'right',
            render: (row) =>
              row.id ? (
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(row.id!)}>
                  Remove
                </Button>
              ) : null,
          },
        ]}
      />
      {adding ? <AddMemberDialog onClose={() => setAdding(false)} /> : null}
    </Section>
  );
}

function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<DealerStaffRole>('SALES_USER');
  const save = useAcctMutation(() => acct.post('/team', { email, role }), onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Add a team member"
      description="They need a Vintrax account first; enter the email they sign in with."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!email} onClick={() => save.mutate(undefined)}>
            Add
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Email" htmlFor="tm-email" error={fieldError(save.error, 'email')}>
          <Input
            id="tm-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Role" htmlFor="tm-role" hint={ROLE_HINTS[role]}>
          <Select
            id="tm-role"
            value={role}
            onChange={(event) => setRole(event.target.value as DealerStaffRole)}
          >
            {DEALER_STAFF_ROLES.filter((entry) => entry !== 'OWNER').map((entry) => (
              <option key={entry} value={entry}>
                {DEALER_STAFF_ROLE_LABELS[entry]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function AuditTrail() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const audit = useAcctQuery<Paged<AuditRow>>(
    ['audit', page, action],
    `/audit${qs({ page, pageSize: 25, action })}`,
  );
  return (
    <Section
      title="Audit trail"
      description="Every posting, reversal, period change, setting and role change, with who did it. It cannot be edited."
      actions={
        <Input
          aria-label="Filter by action"
          placeholder="Action, e.g. sale."
          className="h-9 w-48"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
        />
      }
    >
      <DataTable
        dense
        loading={audit.isPending}
        error={audit.error}
        rows={audit.data?.items}
        rowKey={(row) => row.id}
        columns={[
          { key: 'at', label: 'When', render: (row) => new Date(row.at).toLocaleString('en-CA') },
          { key: 'who', label: 'Who', render: (row) => row.actorEmail ?? 'System' },
          {
            key: 'action',
            label: 'Action',
            render: (row) => <span className="font-mono text-xs">{row.action}</span>,
          },
          { key: 'record', label: 'Record', render: (row) => `${row.entityType}` },
          { key: 'reason', label: 'Reason', render: (row) => row.reason ?? '' },
        ]}
      />
      {audit.data ? (
        <Pagination page={audit.data.page} totalPages={audit.data.totalPages} onChange={setPage} />
      ) : null}
    </Section>
  );
}
