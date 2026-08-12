'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorAlert, Field, Input } from '@/components/ui';

function LoginForm() {
  const login = useAuthStore((state) => state.login);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('from') ?? '/dashboard';

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
      router.push(redirectTo);
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
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorAlert error={error} className="mb-4" />

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Field label="Email" htmlFor="email" error={apiError?.fieldError('email')}>
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

              <Field label="Password" htmlFor="password" error={apiError?.fieldError('password')}>
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
                Sign in
              </Button>
            </form>

            <p className="mt-4 text-sm text-muted-foreground">
              New to Atlas? <Link href="/register" className="text-primary hover:underline">Create an account</Link>
            </p>

            <div className="mt-5 rounded-md border border-border bg-secondary/50 p-3 text-xs">
              <p className="font-semibold">Demo accounts — password AtlasDemo123!</p>
              <ul className="mt-1.5 flex flex-col gap-0.5 text-muted-foreground">
                <li><code>jordan.lee@example.test</code> — buyer</li>
                <li><code>sales@northshoremotors.test</code> — dealer</li>
                <li><code>inspector@atlas.test</code> — inspector</li>
                <li><code>admin@atlas.test</code> — super admin</li>
              </ul>
            </div>
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
