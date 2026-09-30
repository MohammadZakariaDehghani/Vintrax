'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Headset, MessagesSquare } from 'lucide-react';
import type { SupportChatPage, SupportChatStatus } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/utils';
import { Badge, Card, EmptyState, ErrorAlert, Pagination, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

type Filter = 'OPEN' | 'WAITING' | 'CLOSED' | 'ALL';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'OPEN', label: 'Open' },
  { id: 'WAITING', label: 'Asked for a person' },
  { id: 'CLOSED', label: 'Closed' },
  { id: 'ALL', label: 'All' },
];

function SupportChats() {
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (filter === 'OPEN' || filter === 'CLOSED') query.set('status', filter as SupportChatStatus);
  if (filter === 'WAITING') {
    query.set('status', 'OPEN');
    query.set('humanRequested', 'true');
  }

  const { data, isPending, error } = useQuery({
    queryKey: ['support-chats', query.toString()],
    queryFn: () => api.get<SupportChatPage>(`/admin/support-chats?${query.toString()}`),
    placeholderData: (previous) => previous,
    // New chats arrive while the page is open.
    refetchInterval: 15_000,
  });
  const items = data?.items ?? [];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Support chats</h1>
        <p className="mt-1 text-muted-foreground">
          Every conversation visitors have had with the site assistant. Open one to read it and
          reply as the Vintrax team; the assistant stops answering once you do.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === filter}
            onClick={() => {
              setFilter(entry.id);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              entry.id === filter
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <ErrorAlert error={error} className="mb-4" />

      {isPending ? (
        <Spinner label="Loading chats" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessagesSquare className="h-8 w-8" aria-hidden />}
            title="No chats here"
            description="When a visitor uses the chat on the website, the conversation appears here."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {items.map((chat) => (
            <Link
              key={chat.id}
              href={`/admin/support/${chat.id}`}
              className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-secondary/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {chat.visitorName ?? chat.account?.name ?? 'Website visitor'}
                  </span>
                  {chat.visitorEmail ? (
                    <span className="text-sm text-muted-foreground">{chat.visitorEmail}</span>
                  ) : null}
                  {chat.humanRequested && !chat.agentJoined ? (
                    <Badge variant="warning">
                      <Headset className="h-3 w-3" aria-hidden />
                      Waiting for a person
                    </Badge>
                  ) : null}
                  {chat.agentJoined ? <Badge variant="success">Team replied</Badge> : null}
                  {chat.status === 'CLOSED' ? <Badge variant="outline">Closed</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{chat.lastMessage}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {chat.messageCount} messages
                  {chat.pagePath ? ` · started on ${chat.pagePath}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(chat.lastMessageAt)}
                </span>
                {chat.unread > 0 ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                    {chat.unread}
                  </span>
                ) : null}
              </div>
            </Link>
          ))}
        </Card>
      )}

      <Pagination page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />
    </>
  );
}

export default function AdminSupportPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <SupportChats />
      </div>
    </RequireAuth>
  );
}
