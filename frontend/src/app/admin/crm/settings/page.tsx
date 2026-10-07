'use client';

import { useEffect, useState } from 'react';
import { CRM_PRIORITIES } from '@vintrax/shared';
import { Button, ErrorAlert, Field, Input, Select, Spinner } from '@/components/ui';
import { Panel } from '@/components/crm/support-360';
import { PageHeader, fieldError, useCrmMutation, useSupportQuery } from '@/components/crm/ui';
import { humanize, personName, support, type SupportSettingsView } from '@/lib/crm';

type Hours = Record<string, string>;

/** Service targets, reminders, auto-close, ticket categories and teams. */
export default function AdminCrmSettingsPage() {
  const { data, error } = useSupportQuery<SupportSettingsView>(support, ['settings'], '/settings');
  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Spinner />;
  return (
    <>
      <PageHeader title="Support settings" description="Service-level targets, reminders and how tickets are organised. Changes are recorded in the support audit log." />
      <div className="grid gap-4 lg:grid-cols-2">
        <ServiceLevels data={data} />
        <Categories data={data} />
        <Teams data={data} />
      </div>
    </>
  );
}

function toForm(hours: Record<string, number>): Hours {
  return Object.fromEntries(CRM_PRIORITIES.map((priority) => [priority, String(hours[priority] ?? '')]));
}

function ServiceLevels({ data }: { data: SupportSettingsView }) {
  const [first, setFirst] = useState<Hours>(toForm(data.settings.firstResponseHours));
  const [resolution, setResolution] = useState<Hours>(toForm(data.settings.resolutionHours));
  const [waiting, setWaiting] = useState(String(data.settings.waitingReminderDays));
  const [autoClose, setAutoClose] = useState(String(data.settings.autoCloseDays));
  const [team, setTeam] = useState(data.settings.defaultTeamId ?? '');
  const save = useCrmMutation(
    () =>
      support.put('/settings', {
        firstResponseHours: first,
        resolutionHours: resolution,
        waitingReminderDays: waiting,
        autoCloseDays: autoClose,
        defaultTeamId: team || null,
      }),
    undefined,
    'support',
  );
  return (
    <Panel title="Service levels" className="lg:col-span-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Priority</th>
              <th className="py-1 pr-2 font-medium">First response (hours)</th>
              <th className="py-1 font-medium">Resolution (hours)</th>
            </tr>
          </thead>
          <tbody>
            {CRM_PRIORITIES.map((priority) => (
              <tr key={priority}>
                <td className="py-1 pr-2">{humanize(priority)}</td>
                <td className="py-1 pr-2">
                  <Input aria-label={`First response hours, ${humanize(priority)}`} inputMode="decimal" className="w-28" value={first[priority]} onChange={(event) => setFirst({ ...first, [priority]: event.target.value })} />
                </td>
                <td className="py-1">
                  <Input aria-label={`Resolution hours, ${humanize(priority)}`} inputMode="decimal" className="w-28" value={resolution[priority]} onChange={(event) => setResolution({ ...resolution, [priority]: event.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Remind the requester after (days waiting)" htmlFor="ss-waiting" error={fieldError(save.error, 'waitingReminderDays')}>
          <Input id="ss-waiting" inputMode="numeric" value={waiting} onChange={(event) => setWaiting(event.target.value)} />
        </Field>
        <Field label="Close resolved tickets after (days)" htmlFor="ss-close" error={fieldError(save.error, 'autoCloseDays')}>
          <Input id="ss-close" inputMode="numeric" value={autoClose} onChange={(event) => setAutoClose(event.target.value)} />
        </Field>
        <Field label="Default team for new tickets" htmlFor="ss-team">
          <Select id="ss-team" value={team} onChange={(event) => setTeam(event.target.value)}>
            <option value="">None (least busy admin)</option>
            {data.teams.filter((row) => row.isActive).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save service levels</Button>
        {save.isSuccess ? <span className="text-sm text-success">Saved.</span> : null}
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Panel>
  );
}

function Categories({ data }: { data: SupportSettingsView }) {
  const [label, setLabel] = useState('');
  const create = useCrmMutation(() => support.post('/categories', { label }), () => setLabel(''), 'support');
  const update = useCrmMutation(
    (category: SupportSettingsView['categories'][number]) => support.put(`/categories/${category.id}`, { label: category.label, isActive: category.isActive }),
    undefined,
    'support',
  );
  return (
    <Panel title="Ticket categories">
      <ul className="mb-3 divide-y divide-border text-sm">
        {data.categories.map((category) => (
          <CategoryRow key={category.id} category={category} onSave={(next) => update.mutate(next)} busy={update.isPending && update.variables?.id === category.id} />
        ))}
      </ul>
      <div className="flex gap-2">
        <Input aria-label="New category" placeholder="New category" value={label} onChange={(event) => setLabel(event.target.value)} />
        <Button disabled={!label.trim()} loading={create.isPending} onClick={() => create.mutate(undefined)}>Add</Button>
      </div>
      <ErrorAlert error={create.error ?? update.error} className="mt-3" />
    </Panel>
  );
}

function CategoryRow({
  category,
  onSave,
  busy,
}: {
  category: SupportSettingsView['categories'][number];
  onSave: (next: SupportSettingsView['categories'][number]) => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState(category.label);
  useEffect(() => setLabel(category.label), [category.label]);
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5">
      <Input aria-label={`Category name: ${category.label}`} className="max-w-[14rem]" value={label} onChange={(event) => setLabel(event.target.value)} />
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={category.isActive} onChange={(event) => onSave({ ...category, label, isActive: event.target.checked })} /> Active
      </label>
      {label !== category.label ? <Button size="sm" variant="ghost" loading={busy} onClick={() => onSave({ ...category, label })}>Save</Button> : null}
    </li>
  );
}

function Teams({ data }: { data: SupportSettingsView }) {
  const [name, setName] = useState('');
  const create = useCrmMutation(() => support.post('/teams', { name, memberIds: [] }), () => setName(''), 'support');
  const update = useCrmMutation(
    (team: SupportSettingsView['teams'][number]) => support.put(`/teams/${team.id}`, { name: team.name, memberIds: team.memberIds, isActive: team.isActive }),
    undefined,
    'support',
  );
  return (
    <Panel title="Teams">
      <p className="mb-2 text-xs text-muted-foreground">New tickets for a team are assigned to its members in turn. Without a team, the admin with the fewest open tickets gets it.</p>
      <ul className="mb-3 space-y-3 text-sm">
        {data.teams.map((team) => (
          <li key={team.id} className="rounded-md border border-border p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">{team.name}</span>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={team.isActive} onChange={(event) => update.mutate({ ...team, isActive: event.target.checked })} /> Active
              </label>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {data.admins.map((admin) => (
                <label key={admin.id} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={team.memberIds.includes(admin.id)}
                    onChange={(event) =>
                      update.mutate({ ...team, memberIds: event.target.checked ? [...team.memberIds, admin.id] : team.memberIds.filter((memberId) => memberId !== admin.id) })
                    }
                  />
                  {personName(admin)}
                </label>
              ))}
            </div>
          </li>
        ))}
        {data.teams.length === 0 ? <li className="text-muted-foreground">No teams yet.</li> : null}
      </ul>
      <div className="flex gap-2">
        <Input aria-label="New team" placeholder="New team" value={name} onChange={(event) => setName(event.target.value)} />
        <Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate(undefined)}>Add</Button>
      </div>
      <ErrorAlert error={create.error ?? update.error} className="mt-3" />
    </Panel>
  );
}
