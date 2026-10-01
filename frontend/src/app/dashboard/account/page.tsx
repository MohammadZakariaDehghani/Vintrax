'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, PenSquare } from 'lucide-react';
import {
  changeEmailSchema,
  passwordSchema,
  updateProfileSchema,
  type PublicUser,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { useAuthStore, useUser } from '@/store/auth-store';
import { Badge, Button, ErrorAlert, Field, Input } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AccountShell } from '@/components/account/account-shell';

/** The first problem a schema finds, in the words it was written with. */
function firstIssue(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? null : (result.error?.issues[0]?.message ?? 'Check this field');
}

/**
 * One line of settings: what it is, what it is set to, and an Edit button
 * that opens the form for it in place. Only one row is open at a time.
 */
function SettingRow({
  label,
  value,
  editing,
  onEdit,
  editLabel = 'Edit',
  editIcon = PenSquare,
  children,
}: {
  label: string;
  value: ReactNode;
  editing: boolean;
  onEdit: () => void;
  editLabel?: string;
  editIcon?: typeof PenSquare;
  children: ReactNode;
}) {
  const Icon = editIcon;
  return (
    <section className="border-b border-border py-5 first:pt-0" aria-label={label}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold">{label}</h2>
          {editing ? null : (
            <div className="mt-1 break-words text-[15px] text-foreground/85">{value}</div>
          )}
        </div>
        {editing ? null : (
          <Button variant="outline" size="sm" className="shrink-0" onClick={onEdit}>
            <Icon className="h-4 w-4" aria-hidden />
            {editLabel}
          </Button>
        )}
      </div>
      {editing ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

/** Save and Cancel under a row's form. */
function FormActions({
  pending,
  onCancel,
  saveLabel = 'Save',
}: {
  pending: boolean;
  onCancel: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="submit" loading={pending}>
        {saveLabel}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

type RowKey = 'name' | 'username' | 'email' | 'password' | 'phone' | 'postalCode';

function AccountSettings() {
  const user = useUser()!;
  const setUser = useAuthStore((state) => state.setUser);
  const login = useAuthStore((state) => state.login);
  const [open, setOpen] = useState<RowKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [username, setUsername] = useState(user.username ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [postalCode, setPostalCode] = useState(user.postalCode ?? '');
  const [email, setEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const edit = (row: RowKey) => {
    setOpen(row);
    setNotice(null);
    setProblem(null);
    profile.reset();
    changeEmail.reset();
    changePassword.reset();
    // Every form opens on what is saved, not on an abandoned edit.
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setUsername(user.username ?? '');
    setPhone(user.phone ?? '');
    setPostalCode(user.postalCode ?? '');
    setEmail('');
    setEmailPassword('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };
  const close = () => setOpen(null);

  const profile = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<PublicUser>('/me', body),
    onSuccess: (updated) => {
      setUser(updated);
      setOpen(null);
      setNotice('Saved.');
    },
  });

  const changeEmail = useMutation({
    mutationFn: async (body: { email: string; currentPassword: string }) => {
      await api.patch('/auth/email', body);
      return api.get<PublicUser>('/auth/me');
    },
    onSuccess: (updated) => {
      setUser(updated);
      setOpen(null);
      setNotice(
        `Email changed. We sent a link to ${updated.email} — open it to verify the new address.`,
      );
    },
  });

  const resend = useMutation({
    mutationFn: () => api.post('/auth/email/resend'),
    onSuccess: () => setNotice(`We sent a new verification link to ${user.email}.`),
  });

  // Changing a password signs every session out, this one included, so the
  // page signs straight back in with the new password rather than leaving a
  // session that is about to stop working.
  const changePassword = useMutation({
    mutationFn: async () => {
      await api.patch('/auth/password', { currentPassword, newPassword });
      await login({ email: user.email, password: newPassword });
    },
    onSuccess: () => {
      setOpen(null);
      setNotice('Password changed. Every other device you were signed in on has been signed out.');
    },
  });

  function submitProfile(event: FormEvent, body: Record<string, unknown>) {
    event.preventDefault();
    const issue = firstIssue(updateProfileSchema.safeParse(body));
    if (issue) return setProblem(issue);
    setProblem(null);
    profile.mutate(updateProfileSchema.parse(body));
  }

  return (
    <AccountShell title="Account settings">
      <div className="max-w-3xl">
        {notice ? (
          <p
            role="status"
            className="mb-5 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            {notice}
          </p>
        ) : null}

        <SettingRow
          label="Name"
          value={user.displayName}
          editing={open === 'name'}
          onEdit={() => edit('name')}
        >
          <form onSubmit={(e) => submitProfile(e, { firstName, lastName })} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" htmlFor="first-name">
                <Input
                  id="first-name"
                  autoComplete="given-name"
                  maxLength={60}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </Field>
              <Field label="Last name" htmlFor="last-name">
                <Input
                  id="last-name"
                  autoComplete="family-name"
                  maxLength={60}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Field>
            </div>
            <ErrorAlert error={problem ? new Error(problem) : profile.error} className="mt-3" />
            <FormActions pending={profile.isPending} onCancel={close} />
          </form>
        </SettingRow>

        <SettingRow
          label="Username"
          value={user.username ?? <span className="text-muted-foreground">Not set</span>}
          editing={open === 'username'}
          onEdit={() => edit('username')}
        >
          <form onSubmit={(e) => submitProfile(e, { username })} noValidate>
            <Field
              label="Username"
              htmlFor="username"
              hint="3 to 30 letters, numbers, dots or underscores. Buyers and sellers can see it."
            >
              <Input
                id="username"
                autoComplete="username"
                maxLength={30}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <ErrorAlert error={problem ? new Error(problem) : profile.error} className="mt-3" />
            <FormActions pending={profile.isPending} onCancel={close} />
          </form>
        </SettingRow>

        <SettingRow
          label="Email"
          value={
            <span className="flex flex-wrap items-center gap-2">
              {user.email}
              {user.emailVerified ? (
                <Badge variant="success">Verified</Badge>
              ) : (
                <>
                  <Badge variant="warning">Not verified</Badge>
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline disabled:opacity-60"
                    disabled={resend.isPending}
                    onClick={() => resend.mutate()}
                  >
                    Send the link again
                  </button>
                </>
              )}
            </span>
          }
          editing={open === 'email'}
          onEdit={() => edit('email')}
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const body = { email, currentPassword: emailPassword };
              const issue = firstIssue(changeEmailSchema.safeParse(body));
              if (issue) return setProblem(issue);
              setProblem(null);
              changeEmail.mutate(changeEmailSchema.parse(body));
            }}
          >
            <p className="mb-3 text-sm text-muted-foreground">
              Currently <strong className="text-foreground">{user.email}</strong>. You will sign in
              with the new address, and we will ask you to verify it.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New email" htmlFor="new-email">
                <Input
                  id="new-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Current password" htmlFor="email-password" hint="To confirm it is you.">
                <Input
                  id="email-password"
                  type="password"
                  autoComplete="current-password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                />
              </Field>
            </div>
            <ErrorAlert error={problem ? new Error(problem) : changeEmail.error} className="mt-3" />
            <FormActions
              pending={changeEmail.isPending}
              onCancel={close}
              saveLabel="Change email"
            />
          </form>
        </SettingRow>

        <SettingRow
          label="Password"
          value={<span aria-label="Hidden">••••••••</span>}
          editing={open === 'password'}
          onEdit={() => edit('password')}
          editLabel="Change password"
          editIcon={KeyRound}
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const issue =
                (currentPassword ? null : 'Enter your current password') ??
                firstIssue(passwordSchema.safeParse(newPassword)) ??
                (newPassword === confirmPassword ? null : 'The new passwords do not match');
              if (issue) return setProblem(issue);
              setProblem(null);
              changePassword.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Current password" htmlFor="current-password">
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
              <Field label="New password" htmlFor="new-password" hint="At least 10 characters.">
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="confirm-password">
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Changing it signs you out everywhere else.
            </p>
            <ErrorAlert
              error={problem ? new Error(problem) : changePassword.error}
              className="mt-3"
            />
            <FormActions
              pending={changePassword.isPending}
              onCancel={close}
              saveLabel="Change password"
            />
          </form>
        </SettingRow>

        <SettingRow
          label="Phone"
          value={user.phone || <span className="text-muted-foreground">Not set</span>}
          editing={open === 'phone'}
          onEdit={() => edit('phone')}
        >
          <form onSubmit={(e) => submitProfile(e, { phone })} noValidate>
            <Field
              label="Phone"
              htmlFor="phone"
              hint="Shown on your listings to signed-in buyers who ask for it."
            >
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                maxLength={30}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <ErrorAlert error={problem ? new Error(problem) : profile.error} className="mt-3" />
            <FormActions pending={profile.isPending} onCancel={close} />
          </form>
        </SettingRow>

        <SettingRow
          label="Postal code"
          value={user.postalCode ?? <span className="text-muted-foreground">Not set</span>}
          editing={open === 'postalCode'}
          onEdit={() => edit('postalCode')}
        >
          <form
            onSubmit={(e) =>
              submitProfile(e, { postalCode: postalCode.trim() ? postalCode : null })
            }
            noValidate
          >
            <Field
              label="Postal code"
              htmlFor="postal-code"
              hint="The full code, or just the first three characters (e.g. V5L). Never shown to anyone."
            >
              <Input
                id="postal-code"
                autoComplete="postal-code"
                maxLength={7}
                className="max-w-[12rem] uppercase"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </Field>
            <ErrorAlert error={problem ? new Error(problem) : profile.error} className="mt-3" />
            <FormActions pending={profile.isPending} onCancel={close} />
          </form>
        </SettingRow>
      </div>
    </AccountShell>
  );
}

export default function AccountSettingsPage() {
  return (
    <RequireAuth>
      <AccountSettings />
    </RequireAuth>
  );
}
