'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import type { NotificationDto, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatEnum, formatRelativeTime } from '@/lib/utils';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Pagination,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';

function Notifications() {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  /**
   * Which notifications were unread when this page was opened.
   *
   * Opening the page marks everything read, so without a snapshot the "new"
   * marker would vanish on the very refetch that clears the badge, and there
   * would be no way to see what had arrived. This keeps the markers for the
   * visit and lets them go on the next one.
   */
  const [wasUnread, setWasUnread] = useState<ReadonlySet<string> | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['notifications', page],
    queryFn: () => api.get<Paginated<NotificationDto>>(`/notifications?page=${page}&pageSize=20`),
  });

  function refresh() {
    // Prefix match, so this also refreshes the header's ['notifications',
    // 'unread-count'] query and the bell badge clears with the page.
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  const markAllRead = useMutation({
    mutationFn: () => api.patch<{ updated: number }>('/notifications/read-all', {}),
    onSuccess: refresh,
  });

  /**
   * Reading the page is what marks them read.
   *
   * A bell badge means "there is something you have not seen". Once this page
   * has been rendered that is no longer true, so requiring a separate click to
   * say so leaves a count that never goes down — which is what it did.
   */
  const markAll = markAllRead.mutate;
  useEffect(() => {
    if (!data) return;
    setWasUnread(
      (current) =>
        current ?? new Set(data.items.filter((item) => !item.readAt).map((item) => item.id)),
    );
    if (data.items.some((item) => !item.readAt)) markAll();
    // `markAll` is stable and `data` is the trigger; re-running on every field
    // of `data` would re-issue the call after its own refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="container py-8">
      <DashboardNav />

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-1 text-muted-foreground">
          Bids, auction results, messages and moderation decisions. Opening this page marks them
          read, so the bell reflects what you have not seen yet.
        </p>
      </div>

      <ErrorAlert error={error ?? markAllRead.error} className="mb-5" />

      {isPending ? (
        <Spinner label="Loading notifications" />
      ) : data && data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3">
            {data.items.map((notification) => (
              <li key={notification.id}>
                <Card
                  className={cn(
                    // An unread item is marked by a rule down its leading edge
                    // rather than a background wash, so the distinction still
                    // reads in dark mode and does not fight the brand green.
                    // The snapshot, not readAt: this page has just marked
                    // them read, and the reader still needs to see which ones
                    // were new when they arrived.
                    wasUnread?.has(notification.id) && 'border-l-4 border-l-primary',
                  )}
                >
                  <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-5">
                    <div className="min-w-0">
                      <p className="font-semibold">{notification.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {formatEnum(notification.type)} ·{' '}
                        {formatRelativeTime(notification.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {notification.link ? (
                        <Link href={notification.link}>
                          <Button variant="outline" size="sm">
                            Open
                          </Button>
                        </Link>
                      ) : null}
                      {wasUnread?.has(notification.id) ? (
                        <span className="text-xs font-medium text-primary">New</span>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<Bell className="h-8 w-8" aria-hidden />}
            title="Nothing yet"
            description="Bids, auction results, messages and moderation decisions arrive here."
            action={
              <Link href="/vehicles">
                <Button>Browse vehicles</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <Notifications />
    </RequireAuth>
  );
}
