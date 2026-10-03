'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  ACCOUNT_SUBTYPES,
  ACCOUNT_SUBTYPE_LABELS,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  SUBTYPE_TYPE,
  type AccountSubtype,
  type AccountType,
} from '@vintrax/shared';
import { Badge, Button, Dialog, ErrorAlert, Field, Input, Select, Textarea } from '@/components/ui';
import { useAccounting } from '@/components/accounting/context';
import { Amount, Can, DataTable, PageHeader, Section, fieldError, useAccounts, useAcctMutation } from '@/components/accounting/ui';
import { acct, type AccountOption } from '@/lib/accounting';

export default function ChartOfAccountsPage() {
  const { can } = useAccounting();
  const accounts = useAccounts();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountOption | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const rows = (accounts.data ?? []).filter((account) => showInactive || account.isActive);

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description="A Canadian dealership chart, ready to use. Add your own accounts; system accounts the posting engine relies on cannot be removed."
        actions={
          <Can permission="accounting.manage_accounts">
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Add account
            </Button>
          </Can>
        }
      />
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
        Show inactive accounts
      </label>
      {ACCOUNT_TYPES.map((type) => {
        const list = rows.filter((account) => account.type === type);
        if (list.length === 0) return null;
        return (
          <Section key={type} title={ACCOUNT_TYPE_LABELS[type]}>
            <DataTable
              dense
              loading={accounts.isPending}
              error={accounts.error}
              rows={list}
              rowKey={(row) => row.id}
              columns={[
                { key: 'code', label: 'Code', className: 'w-20', render: (row) => <span className="font-mono">{row.code}</span> },
                {
                  key: 'name',
                  label: 'Name',
                  render: (row) => (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/dealer/accounting/ledger?accountId=${row.id}`} className="hover:text-primary">{row.name}</Link>
                      {row.isSystem ? <Badge variant="outline">System</Badge> : null}
                      {row.isBankAccount ? <Badge variant="primary">Bank</Badge> : null}
                      {!row.isActive ? <Badge>Inactive</Badge> : null}
                    </span>
                  ),
                },
                { key: 'subtype', label: 'Subtype', render: (row) => <span className="text-muted-foreground">{ACCOUNT_SUBTYPE_LABELS[row.subtype as AccountSubtype] ?? row.subtype}</span> },
                { key: 'balance', label: 'Balance', align: 'right', render: (row) => <Amount cents={row.balanceCents} /> },
                ...(can('accounting.manage_accounts')
                  ? [{ key: 'edit', label: '', align: 'right' as const, render: (row: AccountOption) => <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>Edit</Button> }]
                  : []),
              ]}
            />
          </Section>
        );
      })}
      {creating ? <CreateAccountDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <EditAccountDialog account={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CreateAccountDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', subtype: 'OPERATING_EXPENSE' as AccountSubtype, description: '' });
  const save = useAcctMutation(() => acct.post('/accounts', { ...form, description: form.description || null }), onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add an account"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!form.code || !form.name} onClick={() => save.mutate(undefined)}>Add account</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code" htmlFor="acc-code" error={fieldError(save.error, 'code')} hint="Unique, e.g. 6215">
          <Input id="acc-code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} />
        </Field>
        <Field label="Name" htmlFor="acc-name" className="sm:col-span-2" error={fieldError(save.error, 'name')}>
          <Input id="acc-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Kind of account" htmlFor="acc-subtype" className="sm:col-span-3" hint="Decides where it appears in the statements.">
          <Select id="acc-subtype" value={form.subtype} onChange={(event) => setForm({ ...form, subtype: event.target.value as AccountSubtype })}>
            {ACCOUNT_TYPES.map((type: AccountType) => (
              <optgroup key={type} label={ACCOUNT_TYPE_LABELS[type]}>
                {ACCOUNT_SUBTYPES.filter((subtype) => SUBTYPE_TYPE[subtype] === type && subtype !== 'CURRENT_YEAR_EARNINGS').map((subtype) => (
                  <option key={subtype} value={subtype}>{ACCOUNT_SUBTYPE_LABELS[subtype]}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Description" htmlFor="acc-description" className="sm:col-span-3">
          <Textarea id="acc-description" className="min-h-[70px]" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}

function EditAccountDialog({ account, onClose }: { account: AccountOption; onClose: () => void }) {
  const [name, setName] = useState(account.name);
  const [description, setDescription] = useState(account.description ?? '');
  const save = useAcctMutation((patch: Record<string, unknown>) => acct.patch(`/accounts/${account.id}`, patch), onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${account.code} · ${account.name}`}
      description={account.isSystem ? 'A system account: it can be renamed but not deactivated.' : undefined}
      footer={
        <>
          {!account.isSystem ? (
            <Button variant="outline" className="mr-auto" loading={save.isPending} onClick={() => save.mutate({ isActive: !account.isActive })}>
              {account.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ name, description: description || null })}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Name" htmlFor="edit-name">
          <Input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Description" htmlFor="edit-description">
          <Textarea id="edit-description" className="min-h-[70px]" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">An account with a balance cannot be deactivated; move the balance with a journal entry first.</p>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}
