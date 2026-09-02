'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/store/session';
import { Button, Card, Field } from '@/components/ui';
import { AppBar } from '@/components/app-bar';

/**
 * Registration creates the same account the web application does — one user
 * record, one set of credentials, one permission set. There is no such thing
 * as a mobile-only account.
 */
export default function RegisterPage() {
  const router = useRouter();
  const register = useAuthStore((state) => state.register);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Role is left to the server's default. Selling is requested from the
      // account screen, so registration stays a four-field form.
      await register({ ...form, role: 'BUYER' });
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Registration failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AppBar title="Create account" back />
      <div className="space-y-4 p-4">
        <Card className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="First name"
                autoComplete="given-name"
                required
                value={form.firstName}
                onChange={update('firstName')}
                error={fieldError('firstName')}
              />
              <Field
                label="Last name"
                autoComplete="family-name"
                required
                value={form.lastName}
                onChange={update('lastName')}
                error={fieldError('lastName')}
              />
            </div>
            <Field
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              value={form.email}
              onChange={update('email')}
              error={fieldError('email')}
            />
            <Field
              label="Password"
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={update('password')}
              error={fieldError('password')}
              hint="At least 10 characters, with upper and lower case, a number and a symbol."
            />

            {error && Object.keys(error instanceof ApiError ? error.details : {}).length === 0 ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error.message}
              </p>
            ) : null}

            <Button type="submit" size="large" fullWidth loading={submitting}>
              Create account
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}
