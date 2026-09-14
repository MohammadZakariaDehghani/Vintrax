'use client';

import { useState } from 'react';
import type { AdminSetPasswordInput } from '@vintrax/shared';
import { Button, ErrorAlert, Field, Input } from '@/components/ui';

/**
 * Setting somebody else's password, as an administrator.
 *
 * This is the recovery path for an account whose owner cannot use the ordinary
 * one — no working mailbox, so no reset link, and no current password to prove.
 * It opens from a single row and replaces that row's controls while it is open,
 * so it is always obvious whose password is being changed: an admin form that
 * floats free of its subject is how the wrong account gets reset.
 *
 * The confirmation field is a UI affordance and nothing more. The server takes
 * one password; typing it twice is what stops a typo becoming an account only
 * the typo can open, since nothing here can read the value back afterwards.
 */
export function SetPasswordPanel({
  displayName,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  displayName: string;
  pending: boolean;
  error: unknown;
  onSubmit: (input: AdminSetPasswordInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 10 && confirm === password;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    const trimmedReason = reason.trim();
    await onSubmit({
      password,
      ...(trimmedReason.length > 0 ? { reason: trimmedReason } : {}),
    });
  }

  return (
    <form className="mt-4 border-t pt-4" onSubmit={handleSubmit}>
      <h3 className="text-sm font-semibold">Set a new password for {displayName}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        This signs them out everywhere and cancels any reset link already sent. Nothing is emailed —
        give them the password yourself and have them change it.
      </p>

      <ErrorAlert error={error} className="mt-3" />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="New password"
          htmlFor="new-password"
          hint="At least 10 characters"
          error={tooShort ? 'At least 10 characters' : undefined}
        >
          <Input
            id="new-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
          />
        </Field>
        <Field
          label="Confirm password"
          htmlFor="confirm-password"
          error={mismatch ? 'The two passwords do not match' : undefined}
        >
          <Input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
            autoComplete="new-password"
          />
        </Field>
        <Field
          label="Reason"
          htmlFor="password-reason"
          hint="Optional — recorded in the audit trail"
          className="sm:col-span-2"
        >
          <Input
            id="password-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            placeholder="Lost access to their mailbox"
          />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={!ready}>
          Set password
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
