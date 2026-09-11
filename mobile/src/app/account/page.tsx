'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ChevronRight,
  Gavel,
  LogOut,
  MailCheck,
  MessageSquare,
  Moon,
  Package,
  Receipt,
} from 'lucide-react';
import { vintrax } from '@/lib/vintrax';
import { useAuthStore, useIsSeller, useUser } from '@/store/session';
import { formatEnum } from '@/lib/format';
import { Button, Card } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { RequireAuth } from '@/components/require-auth';
import { useState } from 'react';

export default function AccountPage() {
  return (
    <>
      <AppBar title="Account" />
      <RequireAuth>
        <Account />
      </RequireAuth>
    </>
  );
}

function Account() {
  const router = useRouter();
  const user = useUser();
  const isSeller = useIsSeller();
  const logout = useAuthStore((state) => state.logout);
  const { resolvedTheme, setTheme } = useTheme();
  const [resent, setResent] = useState<'idle' | 'sent' | 'failed'>('idle');

  if (!user) return null;

  return (
    <div className="space-y-4 p-4">
      <Card className="space-y-1 p-4">
        <p className="text-lg font-semibold">
          {user.firstName} {user.lastName}
        </p>
        <p className="text-sm text-muted-foreground">{user.email}</p>
        <p className="text-xs text-muted-foreground">{formatEnum(user.role)}</p>
      </Card>

      {!user.emailVerified ? (
        <Card className="space-y-3 border-warning p-4">
          <div className="flex items-start gap-2">
            <MailCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="text-sm font-medium">Verify your email</p>
              <p className="text-sm text-muted-foreground">
                Bidding and messaging need a verified address.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            fullWidth
            onClick={async () => {
              try {
                await vintrax.auth.resendVerification();
                setResent('sent');
              } catch {
                setResent('failed');
              }
            }}
          >
            Resend verification email
          </Button>
          {resent === 'sent' ? (
            <p role="status" className="text-sm text-success">
              Sent. Check your inbox.
            </p>
          ) : null}
          {resent === 'failed' ? (
            <p role="alert" className="text-sm text-destructive">
              Could not send it just now. Try again shortly.
            </p>
          ) : null}
        </Card>
      ) : null}

      <nav aria-label="Account sections">
        <Card>
          <ul className="divide-y divide-border">
            <Row href="/account/bids" icon={Gavel} label="My bids" />
            <Row href="/account/orders" icon={Receipt} label="Purchases" />
            <Row href="/messages" icon={MessageSquare} label="Messages" />
            {isSeller ? <Row href="/dealer/inventory" icon={Package} label="My inventory" /> : null}
          </ul>
        </Card>
      </nav>

      <Card>
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left active:bg-secondary"
        >
          <Moon aria-hidden className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">Dark mode</span>
          <span className="text-sm text-muted-foreground">
            {resolvedTheme === 'dark' ? 'On' : 'Off'}
          </span>
        </button>
      </Card>

      <Button
        variant="outline"
        size="large"
        fullWidth
        onClick={async () => {
          await logout();
          router.replace('/');
        }}
      >
        <LogOut aria-hidden className="h-4 w-4" />
        Sign out
      </Button>
    </div>
  );
}

function Row({ href, icon: Icon, label }: { href: string; icon: typeof Gavel; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-touch items-center gap-3 px-4 py-3 active:bg-secondary"
      >
        <Icon aria-hidden className="h-5 w-5 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">{label}</span>
        <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
      </Link>
    </li>
  );
}
