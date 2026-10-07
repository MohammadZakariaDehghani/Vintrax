'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MailX } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button, Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';

interface UnsubscribeInfo {
  dealerName: string;
  email: string;
  unsubscribed: boolean;
}

/**
 * Where the unsubscribe link in a dealer's email lands. Nothing changes on
 * opening the page: mail scanners follow links, so the person confirms with
 * a button. Mail clients that support RFC 8058 one-click post directly.
 */
function Unsubscribe() {
  const token = useSearchParams()?.get('t') ?? '';
  const path = `/crm/public/unsubscribe/${encodeURIComponent(token)}`;
  const info = useQuery({ queryKey: ['unsubscribe', token], queryFn: () => api.get<UnsubscribeInfo>(path), enabled: !!token, retry: false });
  const confirm = useMutation({ mutationFn: () => api.post<{ ok: boolean }>(path) });
  const done = confirm.isSuccess || info.data?.unsubscribed;
  return (
    <div className="container flex max-w-lg justify-center py-16">
      <Card className="w-full">
        <CardContent className="space-y-4 pt-6 text-center">
          <MailX className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight">Unsubscribe</h1>
          {!token ? <p className="text-muted-foreground">This link is missing its code. Use the link from the email.</p> : null}
          {info.isPending && token ? <Spinner /> : null}
          {info.error ? <p className="text-muted-foreground">This link is not valid or has expired.</p> : null}
          {info.data && !done ? (
            <>
              <p>
                Stop marketing email from <strong>{info.data.dealerName}</strong> to <strong>{info.data.email}</strong>?
              </p>
              <p className="text-sm text-muted-foreground">You will still get messages about things you asked for, like replies and appointment confirmations.</p>
              <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>Unsubscribe</Button>
              <ErrorAlert error={confirm.error} />
            </>
          ) : null}
          {info.data && done ? (
            <p>
              You are unsubscribed. <strong>{info.data.dealerName}</strong> will not send marketing email to {info.data.email}.
            </p>
          ) : null}
          <p className="text-sm"><Link href="/" className="text-primary hover:underline">Go to Vintrax</Link></p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense>
      <Unsubscribe />
    </Suspense>
  );
}
