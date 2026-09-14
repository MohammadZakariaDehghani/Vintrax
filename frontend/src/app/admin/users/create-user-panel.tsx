'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { AdminCreateUserInput, UserRole } from '@vintrax/shared';
import { PROVINCES } from '@vintrax/shared';
import { formatEnum } from '@/lib/utils';
import { Button, Card, CardContent, ErrorAlert, Field, Input, Select } from '@/components/ui';

/**
 * Creating an account directly, as an administrator.
 *
 * Collapsed by default: the page's job is the directory, and this is the thing
 * you do occasionally. It opens on demand rather than taking a third of the
 * screen from the list people actually came for.
 *
 * `roles` is what the *server* would accept from this caller, passed down
 * rather than recomputed, so the form cannot drift from the rule that decides.
 */
export function CreateUserPanel({
  assignableRoles: roles,
  pending,
  error,
  onSubmit,
}: {
  assignableRoles: readonly UserRole[];
  pending: boolean;
  error: unknown;
  onSubmit: (input: AdminCreateUserInput) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<UserRole>(roles[0] ?? 'BUYER');
  const [done, setDone] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) => {
      const value = String(form.get(name) ?? '').trim();
      return value.length > 0 ? value : undefined;
    };

    const email = read('email') ?? '';
    await onSubmit({
      email,
      password: String(form.get('password') ?? ''),
      firstName: read('firstName') ?? '',
      lastName: read('lastName') ?? '',
      role,
      phone: read('phone'),
      city: read('city'),
      province: read('province') as AdminCreateUserInput['province'],
      // An administrator typed the address, which is the vouching that email
      // verification would otherwise do. Unticking sends them through it.
      emailVerified: form.get('emailVerified') === 'on',
      dealershipName: read('dealershipName'),
      businessNumber: read('businessNumber'),
      licenceNumber: read('licenceNumber'),
    });

    setDone(email);
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button onClick={() => setOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" aria-hidden />
          Create user
        </Button>
        {done ? (
          <p className="text-sm text-success" role="status">
            Created {done}. Give them the password you set — it is not emailed.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="mb-5">
      <CardContent className="pt-5">
        <h2 className="text-lg font-semibold">Create a user</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The password is set here and shown to nobody afterwards — there is no delivery email, so
          pass it to the person yourself and have them change it.
        </p>

        <ErrorAlert error={error} className="mt-4" />

        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
          <Field label="First name" htmlFor="firstName">
            <Input id="firstName" name="firstName" required maxLength={60} autoComplete="off" />
          </Field>
          <Field label="Last name" htmlFor="lastName">
            <Input id="lastName" name="lastName" required maxLength={60} autoComplete="off" />
          </Field>

          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" required autoComplete="off" />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 10 characters">
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
          </Field>

          <Field label="Role" htmlFor="new-role">
            <Select
              id="new-role"
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
            >
              {roles.map((entry) => (
                <option key={entry} value={entry}>
                  {formatEnum(entry)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" maxLength={30} autoComplete="off" />
          </Field>

          <Field label="Province" htmlFor="province">
            <Select id="province" name="province" defaultValue="">
              <option value="">Not set</option>
              {PROVINCES.map((entry) => (
                <option key={entry} value={entry}>
                  {formatEnum(entry)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" maxLength={80} autoComplete="off" />
          </Field>

          {role === 'DEALER' ? (
            <>
              <Field
                label="Dealership name"
                htmlFor="dealershipName"
                hint="Required — the dealership is created with the account, pending verification"
              >
                <Input id="dealershipName" name="dealershipName" required maxLength={140} />
              </Field>
              <Field label="Business number" htmlFor="businessNumber">
                <Input id="businessNumber" name="businessNumber" maxLength={40} />
              </Field>
              <Field label="Licence number" htmlFor="licenceNumber">
                <Input id="licenceNumber" name="licenceNumber" maxLength={60} />
              </Field>
            </>
          ) : null}

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="emailVerified" defaultChecked className="h-4 w-4" />
            Mark the email address as already verified
          </label>

          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={pending}>
              Create user
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
