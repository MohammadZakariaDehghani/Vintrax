'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Logo } from '@/components/logo';
import { useT } from '@/i18n/provider';

/**
 * Where the verification email's link lands. It confirms the address once,
 * with the single-use token, and then drops the token from the address bar.
 */
function VerifyEmail() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  // Strict mode runs effects twice in development; the token works once.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api
      .post('/auth/email/verify', { token })
      .then(() => setState('done'))
      .catch(() => setState('failed'))
      .finally(() => window.history.replaceState(null, '', '/verify-email'));
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.auth.verifyTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <p role="status" aria-live="polite" className="text-sm">
          {state === 'working'
            ? t.auth.verifying
            : state === 'done'
              ? t.auth.verifyDone
              : t.auth.verifyFailed}
        </p>
        <p className="mt-4 text-sm">
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t.auth.backToSignIn}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="container flex justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Suspense fallback={<div className="py-16" />}>
          <VerifyEmail />
        </Suspense>
      </div>
    </div>
  );
}
