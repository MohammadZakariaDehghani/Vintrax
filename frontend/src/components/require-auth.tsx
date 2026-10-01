'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import {
  useAuthLoading,
  useIsAdmin,
  useIsPrivateSeller,
  useIsSeller,
  useUser,
} from '@/store/auth-store';
import { Button, Card, CardContent, Spinner } from '@/components/ui';

/**
 * Client-side route guard.
 *
 * Purely a user-experience affordance — every rule it appears to enforce is
 * also enforced by the API, because a browser cannot be trusted. It exists so
 * users are not shown doors they cannot open.
 */
export function RequireAuth({
  children,
  sellersOnly = false,
  dealersOnly = false,
  adminOnly = false,
}: {
  children: ReactNode;
  sellersOnly?: boolean;
  /** Dealer tools a private seller does not use: they are sent to My listings. */
  dealersOnly?: boolean;
  adminOnly?: boolean;
}) {
  const user = useUser();
  const isLoading = useAuthLoading();
  const isSeller = useIsSeller();
  const isAdmin = useIsAdmin();
  const privateSeller = useIsPrivateSeller();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Wait for the stored session to be restored before redirecting, or a
    // refresh on a protected route bounces a signed-in user to /login.
    if (!isLoading && !user) {
      router.replace(`/login?from=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, user, router, pathname]);

  const sendToListings = dealersOnly && privateSeller;
  useEffect(() => {
    if (sendToListings) router.replace('/dealer/inventory');
  }, [sendToListings, router]);

  if (isLoading) return <Spinner label="Checking your session" />;
  if (!user) return <Spinner label="Redirecting to sign in" />;
  if (sendToListings) return <Spinner label="Opening My listings" />;

  if (adminOnly && !isAdmin) {
    return <AccessDenied title="Administrator access required" />;
  }

  if (sellersOnly && !isSeller) {
    return (
      <AccessDenied
        title="Seller account required"
        body="Listing a vehicle requires a private seller or dealership account. Your account is set up for buying."
      />
    );
  }

  return <>{children}</>;
}

function AccessDenied({ title, body }: { title: string; body?: string }) {
  return (
    <div className="container py-16">
      <Card>
        <CardContent className="pt-6 text-center">
          <h1 className="text-xl font-semibold">{title}</h1>
          {body ? <p className="mt-2 text-sm text-muted-foreground">{body}</p> : null}
          <Link href="/vehicles" className="mt-4 inline-block">
            <Button variant="outline">Browse vehicles</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
