'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { homeForRole, postLoginRedirect } from '@/lib/post-login-redirect';
import { useAuthStore } from '@/store/auth-store';
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

function LoginForm() {
  const login = useAuthStore((state) => state.login);
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const t = useT();
  const from = searchParams.get('from');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      // Dropped before reading who is now signed in, not after: a stale
      // dashboard query still in the cache from whoever last used this tab
      // must not be the thing this account's own dashboard renders first.
      queryClient.clear();
      const user = useAuthStore.getState().user;
      const destination = user
        ? from
          ? postLoginRedirect(from, user)
          : homeForRole(user)
        : '/dashboard';
      router.push(destination);
      router.refresh();
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
          <p className="max-w-sm text-sm text-muted-foreground">{t.auth.signInSubtitle}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t.auth.signInTitle}</CardTitle>
          </CardHeader>
          <CardContent>
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

              <Field
                label={t.auth.password}
                htmlFor="password"
                error={apiError?.fieldError('password')}
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(apiError?.fieldError('password'))}
                />
              </Field>

              <Button type="submit" loading={submitting} className="w-full">
                {t.auth.signIn}
              </Button>
            </form>

            <p className="mt-4 text-sm text-muted-foreground">
              {t.auth.noAccount}{' '}
              <Link href="/register" className="font-medium text-primary hover:underline">
                {t.auth.createAccount}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="container py-16" />}>
      <LoginForm />
    </Suspense>
  );
}
