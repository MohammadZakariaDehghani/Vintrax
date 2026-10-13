'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api-client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Field,
  Input,
} from '@/components/ui';
import { Logo } from '@/components/logo';
import { useT } from '@/i18n/provider';

/**
 * Where the password-reset email's link lands. The token is single-use and
 * the server checks it; this page only carries it to POST /auth/password/reset.
 * A successful reset does not sign the person in — they sign in with the new
 * password, as the API's policy is.
 */
function ResetPasswordForm() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', { token, password });
      setDone(true);
      // The token is spent; keep it out of the address bar and history.
      window.history.replaceState(null, '', '/reset-password');
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  const apiError = error instanceof ApiError ? error : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.auth.resetTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {done ? (
          <p role="status" className="text-sm">
            {t.auth.resetDone}
          </p>
        ) : !token ? (
          <p role="alert" className="text-sm">
            {t.auth.missingToken}
          </p>
        ) : (
          <>
            <ErrorAlert error={error} className="mb-4" />
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Field
                label={t.auth.newPassword}
                htmlFor="password"
                hint={t.auth.passwordHint}
                error={apiError?.fieldError('password')}
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(apiError?.fieldError('password'))}
                />
              </Field>
              <Button type="submit" loading={submitting} className="w-full">
                {t.auth.resetSubmit}
              </Button>
            </form>
          </>
        )}
        <p className="mt-4 flex flex-wrap gap-4 text-sm">
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t.auth.backToSignIn}
          </Link>
          {!done ? (
            <Link href="/forgot-password" className="font-medium text-primary hover:underline">
              {t.auth.requestNewLink}
            </Link>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="container flex justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Suspense fallback={<div className="py-16" />}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
