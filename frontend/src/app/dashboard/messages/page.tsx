'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import type { ConversationSummary, Paginated } from '@atlas/shared';
import { api } from '@/lib/api-client';
import { formatPrice, formatRelativeTime } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorAlert,
  Pagination,
  Spinner,
} from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';

function Conversations() {
  const [page, setPage] = useState(1);

  const { data, isPending, error } = useQuery({
    queryKey: ['conversations', page],
    queryFn: () =>
      api.get<Paginated<ConversationSummary>>(`/conversations?page=${page}&pageSize=20`),
  });

  return (
    <div className="container py-8">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Messages</h1>
      <ErrorAlert error={error} className="mb-5" />

      {isPending ? (
        <Spinner label="Loading conversations" />
      ) : data && data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3">
            {data.items.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/dashboard/messages/${conversation.id}`}
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="transition-colors hover:border-primary/40">
                    <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-5">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{conversation.vehicle.title}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {conversation.counterparty.displayName}
                          {conversation.lastMessage
                            ? ` · ${formatRelativeTime(conversation.lastMessage.createdAt)}`
                            : ''}
                        </p>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {conversation.lastMessage?.body ?? 'No messages yet'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tabular font-semibold">
                          {formatPrice(conversation.vehicle.priceCad)}
                        </p>
                        {conversation.unreadCount > 0 ? (
                          <Badge className="mt-1">
                            {conversation.unreadCount} unread
                          </Badge>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<MessagesSquare className="h-8 w-8" aria-hidden />}
            title="No conversations yet"
            description="Message a seller from any listing and the thread appears here."
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

export default function MessagesPage() {
  return (
    <RequireAuth>
      <Conversations />
    </RequireAuth>
  );
}
