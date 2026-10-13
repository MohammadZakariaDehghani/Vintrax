'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
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
 * Starts a password reset. The answer is the same whether or not the address
 * has an account — the API never says, and neither does this page.
 */
export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/password/forgot', { email: email.trim() });
      setSent(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  const apiError = error instanceof ApiError ? error : null;

  return (
    <div className="container flex justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">{t.auth.forgotSubtitle}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t.auth.forgotTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {sent ? (
              <p role="status" className="text-sm">
                {t.auth.forgotSent}
              </p>
            ) : (
              <>
                <ErrorAlert error={error} className="mb-4" />
                <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
                  <Field label={t.auth.email} htmlFor="email" error={apiError?.fieldError('email')}>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      aria-invalid={Boolean(apiError?.fieldError('email'))}
                    />
                  </Field>
                  <Button type="submit" loading={submitting} className="w-full">
                    {t.auth.forgotSubmit}
                  </Button>
                </form>
              </>
            )}
            <p className="mt-4 text-sm">
              <Link href="/login" className="font-medium text-primary hover:underline">
                {t.auth.backToSignIn}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
