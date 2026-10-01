'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Inbox, Search, X } from 'lucide-react';
import type { ConversationBox, ConversationSummary, Paginated } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { shortAgo } from '@/lib/messenger';
import { useUser } from '@/store/auth-store';
import { Button, ErrorAlert, Spinner } from '@/components/ui';
import { Avatar, CarPhoto } from './parts';

const BOXES: Array<{ box: ConversationBox; label: string }> = [
  { box: 'ALL', label: 'All' },
  { box: 'BUYING', label: 'Buying' },
  { box: 'SELLING', label: 'Selling' },
  { box: 'ARCHIVED', label: 'Archived' },
];

const EMPTY: Record<ConversationBox, { title: string; body: string }> = {
  ALL: {
    title: 'No messages yet',
    body: 'Message a seller from any listing, or wait for buyers to ask about your car.',
  },
  BUYING: { title: 'Nothing here yet', body: 'Chats about cars you asked about appear here.' },
  SELLING: { title: 'Nothing here yet', body: 'Buyers’ questions about your cars appear here.' },
  ARCHIVED: {
    title: 'No archived chats',
    body: 'Archive a chat to tidy it away. A new message brings it back.',
  },
};

const PAGE_SIZE = 30;

/** Waits until typing pauses before searching. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function ConversationRow({
  conversation,
  active,
  viewerId,
}: {
  conversation: ConversationSummary;
  active: boolean;
  viewerId: string | undefined;
}) {
  const unread = conversation.unreadCount > 0;
  const last = conversation.lastMessage;
  const own = last?.senderId === viewerId;
  const sold = conversation.vehicle.status === 'SOLD';

  return (
    <Link
      href={`/dashboard/messages/${conversation.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-xl p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-primary/10' : 'hover:bg-secondary',
      )}
    >
      <span className="relative">
        <CarPhoto src={conversation.vehicle.primaryImageUrl} className="h-14 w-14 rounded-full" />
        <Avatar
          id={conversation.counterparty.id}
          name={conversation.counterparty.displayName}
          className="absolute -bottom-0.5 -right-0.5 h-6 w-6 text-[9px] ring-2 ring-card"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[15px]',
            unread ? 'font-bold text-foreground' : 'font-medium text-foreground/90',
          )}
        >
          {conversation.counterparty.displayName} · {conversation.vehicle.title}
        </span>
        <span
          className={cn(
            'mt-0.5 flex min-w-0 items-center gap-1 text-[13px]',
            unread ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          <span className="truncate">
            {last ? `${own ? 'You: ' : ''}${last.body}` : 'No messages yet'}
          </span>
          {last ? (
            <span className="shrink-0 text-muted-foreground">· {shortAgo(last.createdAt)}</span>
          ) : null}
        </span>
        {sold ? (
          <span className="mt-1 inline-block rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            Sold
          </span>
        ) : null}
      </span>
      {unread ? (
        <span className="h-3 w-3 shrink-0 rounded-full bg-primary">
          <span className="sr-only">{conversation.unreadCount} unread</span>
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The inbox column: the boxes as pills, a search, and the chats newest first,
 * each with the car's photo and the other person's avatar — the way
 * Marketplace lays out its inbox.
 */
export function ConversationList({ selectedId }: { selectedId: string | undefined }) {
  const user = useUser();
  const [box, setBox] = useState<ConversationBox>('ALL');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);

  const list = useInfiniteQuery({
    queryKey: ['conversations', 'list', box, q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        box,
        page: String(pageParam),
        pageSize: String(PAGE_SIZE),
      });
      if (q) params.set('q', q);
      return api.get<Paginated<ConversationSummary>>(`/conversations?${params.toString()}`);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    // The socket refreshes this the moment something changes; this is the backstop.
    refetchInterval: 60_000,
  });

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 pb-3 pt-4">
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>

        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <label htmlFor="messenger-search" className="sr-only">
            Search messages
          </label>
          <input
            id="messenger-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by car or name"
            maxLength={100}
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Inbox">
          {BOXES.map((option) => {
            const active = option.box === box;
            return (
              <button
                key={option.box}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setBox(option.box)}
                className={cn(
                  'h-8 shrink-0 rounded-md px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-foreground/80 hover:bg-secondary/70 hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2" role="tabpanel">
        <ErrorAlert error={list.error} className="m-2" />
        {list.isPending ? (
          <Spinner label="Loading conversations" />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-muted-foreground">
              <Inbox className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-3 font-semibold">{q ? 'No chats match' : EMPTY[box].title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {q ? 'Try a car’s make or model, or the person’s name.' : EMPTY[box].body}
            </p>
            {!q && box !== 'ARCHIVED' ? (
              <Link href="/vehicles" className="mt-4">
                <Button size="sm">Browse cars</Button>
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-0.5">
              {items.map((conversation) => (
                <li key={conversation.id}>
                  <ConversationRow
                    conversation={conversation}
                    active={conversation.id === selectedId}
                    viewerId={user?.id}
                  />
                </li>
              ))}
            </ul>
            {list.hasNextPage ? (
              <div className="p-3 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  Show more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
