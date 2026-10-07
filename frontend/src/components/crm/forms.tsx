'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  APPOINTMENT_TYPES,
  CONSENT_TYPES,
  CONSENT_TYPE_LABELS,
  CRM_ACTIVITY_LABELS,
  CRM_ACTIVITY_TYPES,
  CRM_PRIORITIES,
  CRM_RECURRENCES,
  PROVINCES,
  PROVINCE_LABELS,
  type ConsentType,
} from '@vintrax/shared';
import { Button, Dialog, ErrorAlert, Field, Input, Select, Textarea } from '@/components/ui';
import {
  crm,
  fromLocalInput,
  humanize,
  toLocalInput,
  type AppointmentRow,
  type TaskRow,
  type TemplateRow,
} from '@/lib/crm';
import { useCrm } from './context';
import { fieldError, useCrmMutation } from './ui';

// --- Lead -----------------------------------------------------------------------------------

export interface LeadFormValue {
  id?: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  preferredContact: 'PHONE' | 'EMAIL' | 'TEXT' | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  sourceId: string | null;
  campaign: string | null;
  vehicleId: string | null;
  interestedVin: string | null;
  vehicleUrl: string | null;
  budgetCents: number | null;
  financingInterest: boolean;
  tradeInInterest: boolean;
  tradeInVehicle: string | null;
  preferredAppointmentAt: string | null;
  notes: string | null;
  statusId: string | null;
  assignedToId: string | null;
  team: string | null;
  nextFollowUpAt: string | null;
  tags: string[];
}

const EMPTY_LEAD: LeadFormValue = {
  firstName: '',
  lastName: null,
  email: null,
  phone: null,
  preferredContact: null,
  address: null,
  city: null,
  province: null,
  postalCode: null,
  sourceId: null,
  campaign: null,
  vehicleId: null,
  interestedVin: null,
  vehicleUrl: null,
  budgetCents: null,
  financingInterest: false,
  tradeInInterest: false,
  tradeInVehicle: null,
  preferredAppointmentAt: null,
  notes: null,
  statusId: null,
  assignedToId: null,
  team: null,
  nextFollowUpAt: null,
  tags: [],
};

interface VehicleOption {
  id: string;
  title: string;
  vin: string | null;
  stockNumber: string | null;
}

export function LeadDialog({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<LeadFormValue>;
  onSaved?: (id: string) => void;
}) {
  const { me, can } = useCrm();
  const [form, setForm] = useState<LeadFormValue>({ ...EMPTY_LEAD, ...initial });
  const [budget, setBudget] = useState(initial?.budgetCents ? String(initial.budgetCents / 100) : '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [consent, setConsent] = useState<{ type: ConsentType | ''; source: string; evidence: string }>({ type: '', source: '', evidence: '' });
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_LEAD, ...initial });
      setBudget(initial?.budgetCents ? String(initial.budgetCents / 100) : '');
      setTags((initial?.tags ?? []).join(', '));
      setConsent({ type: '', source: '', evidence: '' });
    }
  }, [open, initial]);
  const vehicles = useQuery({
    queryKey: ['crm', 'vehicle-options'],
    queryFn: () => crm.get<VehicleOption[]>('/vehicles'),
    enabled: open,
    staleTime: 60_000,
  });
  const set = <K extends keyof LeadFormValue>(key: K) => (value: LeadFormValue[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  const save = useCrmMutation(
    (payload: Record<string, unknown>) =>
      form.id ? crm.put<{ id: string }>(`/leads/${form.id}`, payload) : crm.post<{ id: string }>('/leads', payload),
    (result) => {
      onSaved?.(result.id ?? form.id!);
      onClose();
    },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const rest: Partial<typeof form> = { ...form };
    delete rest.id;
    delete rest.budgetCents;
    save.mutate({
      ...rest,
      budget: budget || null,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      consent: !form.id && consent.type ? { type: consent.type, source: consent.source || 'Recorded by staff', evidence: consent.evidence || null } : null,
    });
  };
  const error = save.error;
  const text = (key: keyof LeadFormValue) => ({
    value: (form[key] as string | null) ?? '',
    onChange: (event: { target: { value: string } }) => set(key)((event.target.value || null) as never),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={form.id ? 'Edit lead' : 'New lead'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-form" loading={save.isPending}>
            {form.id ? 'Save' : 'Create lead'}
          </Button>
        </>
      }
    >
      <form id="lead-form" onSubmit={submit} className="space-y-5">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Contact</legend>
          <Field label="First name" htmlFor="lf-first" error={fieldError(error, 'firstName')}>
            <Input id="lf-first" required value={form.firstName} onChange={(event) => set('firstName')(event.target.value)} />
          </Field>
          <Field label="Last name" htmlFor="lf-last">
            <Input id="lf-last" {...text('lastName')} />
          </Field>
          <Field label="Email" htmlFor="lf-email" error={fieldError(error, 'email')}>
            <Input id="lf-email" type="email" {...text('email')} />
          </Field>
          <Field label="Phone" htmlFor="lf-phone" error={fieldError(error, 'phone')}>
            <Input id="lf-phone" type="tel" {...text('phone')} />
          </Field>
          <Field label="Preferred contact" htmlFor="lf-pref">
            <Select id="lf-pref" value={form.preferredContact ?? ''} onChange={(event) => set('preferredContact')((event.target.value || null) as LeadFormValue['preferredContact'])}>
              <option value="">No preference</option>
              <option value="PHONE">Phone</option>
              <option value="EMAIL">Email</option>
              <option value="TEXT">Text</option>
            </Select>
          </Field>
          <Field label="City" htmlFor="lf-city">
            <Input id="lf-city" {...text('city')} />
          </Field>
          <Field label="Province" htmlFor="lf-prov">
            <Select id="lf-prov" value={form.province ?? ''} onChange={(event) => set('province')(event.target.value || null)}>
              <option value="">—</option>
              {PROVINCES.map((province) => (
                <option key={province} value={province}>
                  {PROVINCE_LABELS[province]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Postal code" htmlFor="lf-postal">
            <Input id="lf-postal" {...text('postalCode')} />
          </Field>
          <Field label="Address" htmlFor="lf-address" className="sm:col-span-2">
            <Input id="lf-address" {...text('address')} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Lead</legend>
          <Field label="Source" htmlFor="lf-source">
            <Select id="lf-source" value={form.sourceId ?? ''} onChange={(event) => set('sourceId')(event.target.value || null)}>
              <option value="">—</option>
              {me.sources.filter((source) => source.isActive !== false).map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campaign" htmlFor="lf-campaign">
            <Input id="lf-campaign" {...text('campaign')} />
          </Field>
          <Field label="Status" htmlFor="lf-status">
            <Select id="lf-status" value={form.statusId ?? ''} onChange={(event) => set('statusId')(event.target.value || null)}>
              <option value="">New</option>
              {me.statuses.filter((status) => status.isActive !== false).map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assigned salesperson" htmlFor="lf-assignee" hint={can('crm.manage') ? 'Empty: your assignment rules decide.' : undefined}>
            <Select id="lf-assignee" value={form.assignedToId ?? ''} disabled={!can('crm.manage')} onChange={(event) => set('assignedToId')(event.target.value || null)}>
              <option value="">{can('crm.manage') ? 'Automatic' : 'Me'}</option>
              {me.staff.filter((person) => person.role !== 'ACCOUNTANT').map((person) => (
                <option key={person.id} value={person.id}>
                  {person.firstName} {person.lastName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next follow-up" htmlFor="lf-follow">
            <Input id="lf-follow" type="datetime-local" value={toLocalInput(form.nextFollowUpAt)} onChange={(event) => set('nextFollowUpAt')(fromLocalInput(event.target.value))} />
          </Field>
          <Field label="Tags" htmlFor="lf-tags" hint="Separate with commas.">
            <Input id="lf-tags" value={tags} onChange={(event) => setTags(event.target.value)} list="lf-tag-list" />
          </Field>
          <datalist id="lf-tag-list">
            {me.tags.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Vehicle interest, trade-in and financing</legend>
          <Field label="Vehicle from your inventory" htmlFor="lf-vehicle" className="sm:col-span-2">
            <Select id="lf-vehicle" value={form.vehicleId ?? ''} onChange={(event) => set('vehicleId')(event.target.value || null)}>
              <option value="">—</option>
              {(vehicles.data ?? []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.title}
                  {vehicle.stockNumber ? ` · #${vehicle.stockNumber}` : vehicle.vin ? ` · …${vehicle.vin.slice(-6)}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Interested VIN" htmlFor="lf-vin">
            <Input id="lf-vin" maxLength={17} {...text('interestedVin')} />
          </Field>
          <Field label="Vehicle link" htmlFor="lf-url" error={fieldError(error, 'vehicleUrl')}>
            <Input id="lf-url" type="url" {...text('vehicleUrl')} />
          </Field>
          <Field label="Budget ($)" htmlFor="lf-budget" error={fieldError(error, 'budget')}>
            <Input id="lf-budget" inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </Field>
          <Field label="Preferred appointment" htmlFor="lf-appt">
            <Input id="lf-appt" type="datetime-local" value={toLocalInput(form.preferredAppointmentAt)} onChange={(event) => set('preferredAppointmentAt')(fromLocalInput(event.target.value))} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.financingInterest} onChange={(event) => set('financingInterest')(event.target.checked)} /> Interested in financing
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.tradeInInterest} onChange={(event) => set('tradeInInterest')(event.target.checked)} /> Has a trade-in
          </label>
          {form.tradeInInterest ? (
            <Field label="Trade-in vehicle" htmlFor="lf-trade" className="sm:col-span-2">
              <Input id="lf-trade" placeholder="2016 Mazda CX-5, 140,000 km" {...text('tradeInVehicle')} />
            </Field>
          ) : null}
          <Field label="Notes" htmlFor="lf-notes" className="sm:col-span-2">
            <Textarea id="lf-notes" rows={3} {...text('notes')} />
          </Field>
        </fieldset>

        {!form.id ? (
          <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Marketing consent (CASL)</legend>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Record consent only if the customer gave it. A lead is not consent: without a record, this lead receives
              no marketing email — only replies to their own request.
            </p>
            <Field label="Consent" htmlFor="lf-consent">
              <Select id="lf-consent" value={consent.type} onChange={(event) => setConsent({ ...consent, type: event.target.value as ConsentType | '' })}>
                <option value="">None recorded</option>
                {CONSENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CONSENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>
            {consent.type ? (
              <>
                <Field label="Where it was given" htmlFor="lf-csource">
                  <Input id="lf-csource" required placeholder="Showroom sign-up form" value={consent.source} onChange={(event) => setConsent({ ...consent, source: event.target.value })} />
                </Field>
                <Field label="What they agreed to" htmlFor="lf-cevidence" className="sm:col-span-2">
                  <Input id="lf-cevidence" placeholder="Ticked “Email me offers from North Shore Motors”" value={consent.evidence} onChange={(event) => setConsent({ ...consent, evidence: event.target.value })} />
                </Field>
              </>
            ) : null}
          </fieldset>
        ) : null}
        <ErrorAlert error={error} />
      </form>
    </Dialog>
  );
}

// --- Task -------------------------------------------------------------------------------------

export function TaskDialog({
  open,
  onClose,
  task,
  leadId,
}: {
  open: boolean;
  onClose: () => void;
  task?: TaskRow | null;
  leadId?: string | null;
}) {
  const { me, can } = useCrm();
  const blank = { title: '', description: '', dueAt: '', priority: 'MEDIUM', status: 'OPEN', reminderAt: '', recurrence: 'NONE', assignedToId: '' };
  const [form, setForm] = useState(blank);
  useEffect(() => {
    if (!open) return;
    setForm(
      task
        ? {
            title: task.title,
            description: task.description ?? '',
            dueAt: toLocalInput(task.dueAt),
            priority: task.priority,
            status: task.status,
            reminderAt: toLocalInput(task.reminderAt),
            recurrence: task.recurrence,
            assignedToId: task.assignedToId ?? '',
          }
        : { ...blank, assignedToId: me.me.userId },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task]);
  const save = useCrmMutation(
    (payload: Record<string, unknown>) => (task ? crm.put(`/tasks/${task.id}`, payload) : crm.post('/tasks', payload)),
    () => onClose(),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      title: form.title,
      description: form.description || null,
      leadId: task?.leadId ?? leadId ?? null,
      assignedToId: form.assignedToId || null,
      vehicleId: task?.vehicleId ?? null,
      dueAt: fromLocalInput(form.dueAt),
      priority: form.priority,
      status: form.status,
      reminderAt: fromLocalInput(form.reminderAt),
      recurrence: form.recurrence,
    });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'New task'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" loading={save.isPending}>
            Save task
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor="tf-title" className="sm:col-span-2" error={fieldError(save.error, 'title')}>
          <Input id="tf-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="Due" htmlFor="tf-due" error={fieldError(save.error, 'dueAt')}>
          <Input id="tf-due" type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />
        </Field>
        <Field label="Reminder" htmlFor="tf-reminder" error={fieldError(save.error, 'reminderAt')}>
          <Input id="tf-reminder" type="datetime-local" value={form.reminderAt} onChange={(event) => setForm({ ...form, reminderAt: event.target.value })} />
        </Field>
        <Field label="Priority" htmlFor="tf-priority">
          <Select id="tf-priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
            {CRM_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {humanize(priority)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Repeats" htmlFor="tf-recurrence">
          <Select id="tf-recurrence" value={form.recurrence} onChange={(event) => setForm({ ...form, recurrence: event.target.value })}>
            {CRM_RECURRENCES.map((recurrence) => (
              <option key={recurrence} value={recurrence}>
                {recurrence === 'NONE' ? 'Does not repeat' : humanize(recurrence)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assigned to" htmlFor="tf-assignee">
          <Select id="tf-assignee" value={form.assignedToId} disabled={!can('crm.manage')} onChange={(event) => setForm({ ...form, assignedToId: event.target.value })}>
            {me.staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.firstName} {person.lastName}
              </option>
            ))}
          </Select>
        </Field>
        {task ? (
          <Field label="Status" htmlFor="tf-status">
            <Select id="tf-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((status) => (
                <option key={status} value={status}>
                  {humanize(status)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Description" htmlFor="tf-description" className="sm:col-span-2">
          <Textarea id="tf-description" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <ErrorAlert error={save.error} className="sm:col-span-2" />
      </form>
    </Dialog>
  );
}

// --- Appointment --------------------------------------------------------------------------------

export function AppointmentDialog({
  open,
  onClose,
  appointment,
  leadId,
  defaultStart,
}: {
  open: boolean;
  onClose: () => void;
  appointment?: AppointmentRow | null;
  leadId?: string | null;
  defaultStart?: Date;
}) {
  const { me, can } = useCrm();
  const [form, setForm] = useState({ type: 'TEST_DRIVE', startsAt: '', endsAt: '', location: '', notes: '', status: 'SCHEDULED', reminderMinutes: '60', salespersonId: '' });
  useEffect(() => {
    if (!open) return;
    if (appointment) {
      setForm({
        type: appointment.type,
        startsAt: toLocalInput(appointment.startsAt),
        endsAt: toLocalInput(appointment.endsAt),
        location: appointment.location ?? '',
        notes: appointment.notes ?? '',
        status: appointment.status,
        reminderMinutes: appointment.reminderMinutes === null ? '' : String(appointment.reminderMinutes),
        salespersonId: appointment.salespersonId ?? '',
      });
    } else {
      const start = defaultStart ?? new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 86_400_000);
      setForm({
        type: 'TEST_DRIVE',
        startsAt: toLocalInput(start),
        endsAt: toLocalInput(new Date(start.getTime() + 3_600_000)),
        location: '',
        notes: '',
        status: 'SCHEDULED',
        reminderMinutes: '60',
        salespersonId: me.me.userId,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment]);
  const save = useCrmMutation(
    (payload: Record<string, unknown>) => (appointment ? crm.put(`/appointments/${appointment.id}`, payload) : crm.post('/appointments', payload)),
    () => onClose(),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      leadId: appointment?.leadId ?? leadId,
      vehicleId: appointment?.vehicleId ?? null,
      salespersonId: form.salespersonId || null,
      type: form.type,
      startsAt: fromLocalInput(form.startsAt),
      endsAt: fromLocalInput(form.endsAt),
      location: form.location || null,
      notes: form.notes || null,
      status: form.status,
      reminderMinutes: form.reminderMinutes === '' ? null : Number(form.reminderMinutes),
    });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={appointment ? 'Edit appointment' : 'Book an appointment'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="appt-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="appt-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="af-type">
          <Select id="af-type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            {APPOINTMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanize(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Salesperson" htmlFor="af-sales">
          <Select id="af-sales" value={form.salespersonId} disabled={!can('crm.manage')} onChange={(event) => setForm({ ...form, salespersonId: event.target.value })}>
            {me.staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.firstName} {person.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Starts" htmlFor="af-start">
          <Input
            id="af-start"
            type="datetime-local"
            required
            value={form.startsAt}
            onChange={(event) => {
              const start = event.target.value;
              const end = start ? toLocalInput(new Date(new Date(start).getTime() + 3_600_000)) : form.endsAt;
              setForm({ ...form, startsAt: start, endsAt: end });
            }}
          />
        </Field>
        <Field label="Ends" htmlFor="af-end" error={fieldError(save.error, 'endsAt')}>
          <Input id="af-end" type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} />
        </Field>
        <Field label="Location" htmlFor="af-location">
          <Input id="af-location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
        </Field>
        <Field label="Remind (minutes before)" htmlFor="af-remind">
          <Input id="af-remind" type="number" min={0} value={form.reminderMinutes} onChange={(event) => setForm({ ...form, reminderMinutes: event.target.value })} />
        </Field>
        {appointment ? (
          <Field label="Status" htmlFor="af-status">
            <Select id="af-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((status) => (
                <option key={status} value={status}>
                  {humanize(status)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Notes" htmlFor="af-notes" className="sm:col-span-2">
          <Textarea id="af-notes" rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
        <ErrorAlert error={save.error} className="sm:col-span-2" />
      </form>
    </Dialog>
  );
}

// --- Activity ------------------------------------------------------------------------------------

export function ActivityDialog({ open, onClose, leadId, defaultType = 'CALL' }: { open: boolean; onClose: () => void; leadId: string; defaultType?: string }) {
  const [form, setForm] = useState({ type: defaultType, title: '', notes: '', outcome: '', nextAction: '', nextFollowUpAt: '' });
  useEffect(() => {
    if (open) setForm({ type: defaultType, title: '', notes: '', outcome: '', nextAction: '', nextFollowUpAt: '' });
  }, [open, defaultType]);
  const save = useCrmMutation((payload: Record<string, unknown>) => crm.post(`/leads/${leadId}/activities`, payload), () => onClose());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      type: form.type,
      title: form.title || CRM_ACTIVITY_LABELS[form.type as keyof typeof CRM_ACTIVITY_LABELS],
      notes: form.notes || null,
      outcome: form.outcome || null,
      nextAction: form.nextAction || null,
      nextFollowUpAt: fromLocalInput(form.nextFollowUpAt),
    });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log activity"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="activity-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="activity-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="ac-type">
          <Select id="ac-type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            {CRM_ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {CRM_ACTIVITY_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Summary" htmlFor="ac-title">
          <Input id="ac-title" placeholder={CRM_ACTIVITY_LABELS[form.type as keyof typeof CRM_ACTIVITY_LABELS]} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="Outcome" htmlFor="ac-outcome">
          <Input id="ac-outcome" value={form.outcome} onChange={(event) => setForm({ ...form, outcome: event.target.value })} />
        </Field>
        <Field label="Next action" htmlFor="ac-next">
          <Input id="ac-next" value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} />
        </Field>
        <Field label="Next follow-up" htmlFor="ac-follow">
          <Input id="ac-follow" type="datetime-local" value={form.nextFollowUpAt} onChange={(event) => setForm({ ...form, nextFollowUpAt: event.target.value })} />
        </Field>
        <Field label="Notes" htmlFor="ac-notes" className="sm:col-span-2">
          <Textarea id="ac-notes" rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
        <ErrorAlert error={save.error} className="sm:col-span-2" />
      </form>
    </Dialog>
  );
}

// --- Email composer ----------------------------------------------------------------------------------

export function ComposeDialog({ open, onClose, leadId, marketingAllowed }: { open: boolean; onClose: () => void; leadId: string; marketingAllowed: boolean }) {
  const { can } = useCrm();
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [purpose, setPurpose] = useState<'TRANSACTIONAL' | 'MARKETING'>('TRANSACTIONAL');
  const [when, setWhen] = useState('');
  const [businessHours, setBusinessHours] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const templates = useQuery({
    queryKey: ['crm', 'templates-active'],
    queryFn: () => crm.get<TemplateRow[]>('/templates'),
    enabled: open,
  });
  useEffect(() => {
    if (!open) return;
    setTemplateId('');
    setSubject('');
    setBody('');
    setPurpose('TRANSACTIONAL');
    setWhen('');
    setBusinessHours(false);
    setPreview(null);
  }, [open]);
  const pickTemplate = async (id: string) => {
    setTemplateId(id);
    if (!id) return;
    const template = await crm.get<{ subject: string; bodyHtml: string; purpose: 'TRANSACTIONAL' | 'MARKETING' }>(`/templates/${id}`);
    setSubject(template.subject);
    setBody(template.bodyHtml);
    setPurpose(template.purpose);
    setPreview(null);
  };
  const doPreview = useCrmMutation(
    () => crm.post<{ subject: string; html: string }>('/email/preview', { subject, bodyHtml: body, leadId }),
    (result) => setPreview(result),
    'crm-preview',
  );
  const send = useCrmMutation(
    () =>
      crm.post('/emails', {
        leadId,
        templateId: templateId || null,
        subject,
        bodyHtml: body,
        purpose,
        scheduledAt: fromLocalInput(when),
        respectSendWindow: businessHours,
      }),
    () => onClose(),
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Email the customer"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => doPreview.mutate(undefined)} loading={doPreview.isPending} disabled={!subject || !body}>
            Preview
          </Button>
          <Button onClick={() => send.mutate(undefined)} loading={send.isPending} disabled={!subject || !body}>
            {when ? 'Schedule' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Template" htmlFor="ce-template">
          <Select id="ce-template" value={templateId} onChange={(event) => void pickTemplate(event.target.value)}>
            <option value="">Write my own</option>
            {(templates.data ?? []).filter((template) => template.isActive).map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind" htmlFor="ce-purpose" hint={purpose === 'MARKETING' && !marketingAllowed ? 'No current marketing consent: this will not be sent.' : undefined}>
          <Select id="ce-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value as 'TRANSACTIONAL' | 'MARKETING')}>
            <option value="TRANSACTIONAL">Reply / follow-up on their request</option>
            {can('crm.marketing') ? <option value="MARKETING">Marketing (needs consent)</option> : null}
          </Select>
        </Field>
        <Field label="Subject" htmlFor="ce-subject" className="sm:col-span-2" error={fieldError(send.error, 'subject')}>
          <Input id="ce-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
        </Field>
        <Field label="Message (HTML; variables like {{customer.first_name}})" htmlFor="ce-body" className="sm:col-span-2" error={fieldError(send.error, 'bodyHtml')}>
          <Textarea id="ce-body" rows={9} className="font-mono text-xs" value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>
        <Field label="Send later (optional)" htmlFor="ce-when">
          <Input id="ce-when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
        </Field>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={businessHours} onChange={(event) => setBusinessHours(event.target.checked)} /> Hold for business hours
        </label>
      </div>
      <ErrorAlert error={doPreview.error ?? send.error} className="mt-3" />
      {preview ? (
        <div className="mt-4 rounded-md border border-border">
          <p className="border-b border-border bg-secondary/40 px-3 py-2 text-sm font-semibold">{preview.subject}</p>
          {/* The server sanitised this HTML and escaped every variable value. */}
          <div className="prose prose-sm max-w-none px-3 py-2" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      ) : null}
    </Dialog>
  );
}
