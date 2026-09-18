'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { postLoginRedirect } from '@/lib/post-login-redirect';
import { useAuthStore } from '@/store/session';
import { Button, Card, Field } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { Logo } from '@/components/logo';

export default function LoginPage() {
  return (
    // useSearchParams needs a boundary, or the whole route opts out of static
    // rendering.
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const login = useAuthStore((state) => state.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      // Dropped before reading who just signed in: a cached query from
      // whoever last used this device must not be the thing this account's
      // own screens render first.
      queryClient.clear();
      const next = params.get('next');
      const user = useAuthStore.getState().user;
      router.replace(next && user ? postLoginRedirect(next, user) : '/');
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Sign in failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AppBar title="Sign in" back />
      <div className="space-y-4 p-4">
        <div className="flex flex-col items-center gap-2 pt-2">
          <Logo className="h-12" />
          <p className="text-sm text-muted-foreground">Sign in to Vintrax</p>
        </div>

        <Card className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={fieldError('email')}
            />
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldError('password')}
            />

            {error && !fieldError('email') && !fieldError('password') ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error instanceof ApiError && error.status === 401
                  ? 'That email and password do not match an account.'
                  : error.message}
              </p>
            ) : null}

            <Button type="submit" size="large" fullWidth loading={submitting}>
              Sign in
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          New to Vintrax?{' '}
          <Link href="/register" className="font-medium text-primary">
            Create an account
          </Link>
        </p>
      </div>
    </>
  );
}
