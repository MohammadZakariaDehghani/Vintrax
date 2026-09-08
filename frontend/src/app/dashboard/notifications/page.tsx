'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import type { NotificationDto, Paginated } from '@atlas/shared';
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

function Notifications() {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: ['notifications', page],
    queryFn: () => api.get<Paginated<NotificationDto>>(`/notifications?page=${page}&pageSize=20`),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  const markAllRead = useMutation({
    mutationFn: () => api.patch<{ updated: number }>('/notifications/read-all', {}),
    onSuccess: refresh,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch<void>(`/notifications/${id}/read`, {}),
    onSuccess: refresh,
  });

  const unread = data?.items.filter((notification) => !notification.readAt).length ?? 0;

  return (
    <div className="container py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
        {unread > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            Mark all as read
          </Button>
        ) : null}
      </div>

      <ErrorAlert error={error ?? markAllRead.error ?? markRead.error} className="mb-5" />

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
                    // reads in dark mode and does not fight the brand navy.
                    !notification.readAt && 'border-l-4 border-l-primary',
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
                        <Link
                          href={notification.link}
                          onClick={() => {
                            if (!notification.readAt) markRead.mutate(notification.id);
                          }}
                        >
                          <Button variant="outline" size="sm">
                            Open
                          </Button>
                        </Link>
                      ) : null}
                      {!notification.readAt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markRead.mutate(notification.id)}
                          disabled={markRead.isPending}
                        >
                          Mark read
                        </Button>
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
