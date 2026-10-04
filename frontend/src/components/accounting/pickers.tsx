'use client';

import { useState } from 'react';
import {
  PROVINCES,
  PROVINCE_LABELS,
  VENDOR_KINDS,
  VENDOR_KIND_LABELS,
  type VendorKind,
} from '@vintrax/shared';
import { Button, Dialog, ErrorAlert, Field, Input, Select } from '@/components/ui';
import { acct, money } from '@/lib/accounting';
import { useAccounting } from './context';
import {
  fieldError,
  useAcctMutation,
  useBankOptions,
  useCustomers,
  useVehicleOptions,
  useVendors,
  vehicleLabel,
} from './ui';

/** Choose a customer, or add one without leaving the form. */
export function CustomerSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const customers = useCustomers();
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex gap-2">
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a customer</option>
        {customers.data?.items.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
          </option>
        ))}
      </Select>
      <Button type="button" variant="outline" onClick={() => setAdding(true)}>
        New
      </Button>
      {adding ? (
        <PartyDialog
          kind="customer"
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            onChange(created.id);
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Choose a vendor (optionally of one kind), or add one. */
export function VendorSelect({
  id,
  value,
  onChange,
  kind,
  placeholder = 'Choose a vendor',
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  kind?: VendorKind;
  placeholder?: string;
}) {
  const { can } = useAccounting();
  const vendors = useVendors(kind);
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex gap-2">
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {vendors.data?.items.map((vendor) => (
          <option key={vendor.id} value={vendor.id}>
            {vendor.name}
          </option>
        ))}
      </Select>
      {can('accounting.create') ? (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>
          New
        </Button>
      ) : null}
      {adding ? (
        <PartyDialog
          kind="vendor"
          vendorKind={kind}
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            onChange(created.id);
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}

export function BankSelect({
  id,
  value,
  onChange,
  placeholder = 'Choose an account',
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const banks = useBankOptions();
  return (
    <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {banks.data?.map((bank) => (
        <option key={bank.id} value={bank.id}>
          {bank.name}
        </option>
      ))}
    </Select>
  );
}

/** Search the dealership's vehicles by VIN, stock number, make or model. */
export function VehicleSelect({
  id,
  value,
  onChange,
  includeSold,
  placeholder = 'Choose a vehicle',
}: {
  id: string;
  value: string;
  onChange: (id: string, vehicle?: { askingPriceCents: number }) => void;
  includeSold?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const vehicles = useVehicleOptions(q, includeSold);
  const list = vehicles.data ?? [];
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        aria-label="Search vehicles"
        placeholder="VIN, stock #, make…"
        className="sm:w-44"
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
      <Select
        id={id}
        value={value}
        onChange={(event) => {
          const vehicle = list.find((entry) => entry.id === event.target.value);
          onChange(event.target.value, vehicle);
        }}
      >
        <option value="">{placeholder}</option>
        {list.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicleLabel(vehicle)} · {money(vehicle.askingPriceCents)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Adds a customer or vendor. */
export function PartyDialog({
  kind,
  vendorKind,
  onClose,
  onCreated,
  existing,
}: {
  kind: 'customer' | 'vendor';
  vendorKind?: VendorKind;
  onClose: () => void;
  onCreated?: (created: { id: string; name: string }) => void;
  existing?: Record<string, unknown> & { id: string };
}) {
  const [form, setForm] = useState({
    name: String(existing?.name ?? ''),
    email: String(existing?.email ?? ''),
    phone: String(existing?.phone ?? ''),
    address: String(existing?.address ?? ''),
    city: String(existing?.city ?? ''),
    province: String(existing?.province ?? ''),
    postalCode: String(existing?.postalCode ?? ''),
    kind: String(existing?.kind ?? vendorKind ?? 'SUPPLIER'),
    gstNumber: String(existing?.gstNumber ?? ''),
    paymentTermsDays: String(existing?.paymentTermsDays ?? '30'),
    notes: String(existing?.notes ?? ''),
  });
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const save = useAcctMutation(
    () => {
      const common = {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        province: form.province || null,
        notes: form.notes || null,
      };
      const body =
        kind === 'customer'
          ? { ...common, city: form.city || null, postalCode: form.postalCode || null }
          : {
              ...common,
              kind: form.kind,
              gstNumber: form.gstNumber || null,
              paymentTermsDays: Number(form.paymentTermsDays || 0),
            };
      const path = `/${kind === 'customer' ? 'customers' : 'vendors'}`;
      return existing
        ? acct.patch<{ id: string; name: string }>(`${path}/${existing.id}`, body)
        : acct.post<{ id: string; name: string }>(path, body);
    },
    (created) => {
      onCreated?.(created);
      onClose();
    },
  );
  const title = `${existing ? 'Edit' : 'New'} ${kind}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!form.name.trim()}
            onClick={() => save.mutate(undefined)}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          htmlFor="party-name"
          className="sm:col-span-2"
          error={fieldError(save.error, 'name')}
        >
          <Input
            id="party-name"
            value={form.name}
            onChange={(event) => set('name')(event.target.value)}
          />
        </Field>
        {kind === 'vendor' ? (
          <Field label="Kind" htmlFor="party-kind">
            <Select
              id="party-kind"
              value={form.kind}
              onChange={(event) => set('kind')(event.target.value)}
            >
              {VENDOR_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {VENDOR_KIND_LABELS[entry]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Email" htmlFor="party-email" error={fieldError(save.error, 'email')}>
          <Input
            id="party-email"
            type="email"
            value={form.email}
            onChange={(event) => set('email')(event.target.value)}
          />
        </Field>
        <Field label="Phone" htmlFor="party-phone">
          <Input
            id="party-phone"
            value={form.phone}
            onChange={(event) => set('phone')(event.target.value)}
          />
        </Field>
        <Field label="Address" htmlFor="party-address" className="sm:col-span-2">
          <Input
            id="party-address"
            value={form.address}
            onChange={(event) => set('address')(event.target.value)}
          />
        </Field>
        {kind === 'customer' ? (
          <>
            <Field label="City" htmlFor="party-city">
              <Input
                id="party-city"
                value={form.city}
                onChange={(event) => set('city')(event.target.value)}
              />
            </Field>
            <Field label="Postal code" htmlFor="party-postal">
              <Input
                id="party-postal"
                value={form.postalCode}
                onChange={(event) => set('postalCode')(event.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="GST/HST number" htmlFor="party-gst">
              <Input
                id="party-gst"
                value={form.gstNumber}
                onChange={(event) => set('gstNumber')(event.target.value)}
              />
            </Field>
            <Field label="Payment terms (days)" htmlFor="party-terms">
              <Input
                id="party-terms"
                type="number"
                min={0}
                max={365}
                value={form.paymentTermsDays}
                onChange={(event) => set('paymentTermsDays')(event.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Province" htmlFor="party-province">
          <Select
            id="party-province"
            value={form.province}
            onChange={(event) => set('province')(event.target.value)}
          >
            <option value="">—</option>
            {PROVINCES.map((province) => (
              <option key={province} value={province}>
                {PROVINCE_LABELS[province]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorAlert error={save.error} className="mt-3" />
    </Dialog>
  );
}
