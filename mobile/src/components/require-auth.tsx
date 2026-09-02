'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Permission } from '@atlas/shared';
import { useAuthLoading, useUser } from '@/store/session';
import { Spinner, StateMessage, Button } from '@/components/ui';

/**
 * Route guard.
 *
 * This is convenience, not security: every rule it appears to enforce is also
 * enforced by the API, which re-reads the user on every request. Hiding a
 * screen the server would refuse just saves a pointless round trip and a
 * confusing error.
 */
export function RequireAuth({
  children,
  permission,
}: {
  children: React.ReactNode;
  permission?: Permission;
}) {
  const user = useUser();
  const loading = useAuthLoading();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || user) return;
    // Carry where they were going, so signing in returns them there rather
    // than dumping them on the home screen.
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (loading) return <Spinner label="Checking your session" />;
  if (!user) return <Spinner label="Redirecting to sign in" />;

  if (permission && !user.permissions.includes(permission)) {
    return (
      <StateMessage
        tone="error"
        title="Not available on this account"
        description="Your account does not have access to this area. If that looks wrong, the account's role may have changed."
        action={
          <Button variant="secondary" onClick={() => router.push('/')}>
            Go home
          </Button>
        }
      />
    );
  }

  return <>{children}</>;
}
