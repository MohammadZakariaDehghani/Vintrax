'use client';

import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  SendHorizontal,
} from 'lucide-react';
import {
  MAX_MESSAGE_LENGTH,
  type ConversationDetail,
  type ConversationSummary,
  type MessageDto,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatEnum, formatPrice } from '@/lib/utils';
import { QUICK_REPLIES, clockTime, dayLabel, groupThread } from '@/lib/messenger';
import { useUser } from '@/store/auth-store';
import { Button, Dialog, ErrorAlert, Spinner } from '@/components/ui';
import { Avatar, CarPhoto } from './parts';

/** A message on its way: shown at once, swapped for the real one when the API answers. */
interface Outgoing {
  key: string;
  body: string;
  failed: boolean;
}

/**
 * Bubble corners, Messenger-style: a run of messages from one person reads as
 * one block, rounded on the outside and tight where the bubbles meet.
 */
function corners(own: boolean, index: number, count: number): string {
  if (count === 1) return 'rounded-[20px]';
  const first = index === 0;
  const last = index === count - 1;
  if (own) {
    return cn(
      'rounded-l-[20px]',
      first
        ? 'rounded-tr-[20px] rounded-br-md'
        : last
          ? 'rounded-tr-md rounded-br-[20px]'
          : 'rounded-r-md',
    );
  }
  return cn(
    'rounded-r-[20px]',
    first
      ? 'rounded-tl-[20px] rounded-bl-md'
      : last
        ? 'rounded-tl-md rounded-bl-[20px]'
        : 'rounded-l-md',
  );
}

function ThreadHeader({
  thread,
  onArchive,
  archiving,
}: {
  thread: ConversationSummary;
  onArchive: () => void;
  archiving: boolean;
}) {
  const ArchiveIcon = thread.archived ? ArchiveRestore : Archive;
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
      <Link
        href="/dashboard/messages"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-primary hover:bg-secondary md:hidden"
        aria-label="All messages"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </Link>
      <Avatar
        id={thread.counterparty.id}
        name={thread.counterparty.displayName}
        className="h-10 w-10"
      />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-bold leading-tight">
          {thread.counterparty.displayName}
        </h2>
        <p className="truncate text-xs text-muted-foreground">
          {thread.viewerRole === 'SELLER' ? 'Asking about your car' : 'Seller'} ·{' '}
          {thread.vehicle.title}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-full text-primary"
        onClick={onArchive}
        disabled={archiving}
        aria-label={thread.archived ? 'Move back to inbox' : 'Archive chat'}
        title={thread.archived ? 'Move back to inbox' : 'Archive chat'}
      >
        <ArchiveIcon className="h-5 w-5" aria-hidden />
      </Button>
    </div>
  );
}

function CarStrip({ thread, onMarkSold }: { thread: ConversationSummary; onMarkSold: () => void }) {
  const { vehicle } = thread;
  const sold = vehicle.status === 'SOLD';
  const canMarkSold = thread.viewerRole === 'SELLER' && !sold;
  return (
    <div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-3 py-2 sm:px-4">
      <CarPhoto src={vehicle.primaryImageUrl} className="h-11 w-11 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{vehicle.title}</p>
        <p className="text-xs text-muted-foreground">
          <span className="tabular font-semibold text-foreground">
            {formatPrice(vehicle.priceCad)}
          </span>
          {vehicle.status !== 'ACTIVE' ? ` · ${formatEnum(vehicle.status)}` : ''}
        </p>
      </div>
      {canMarkSold ? (
        <Button size="sm" className="shrink-0 rounded-full px-3.5" onClick={onMarkSold}>
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Mark as sold</span>
          <span className="sm:hidden">Sold</span>
        </Button>
      ) : null}
      <Link href={`/vehicles/${vehicle.slug}`} className="shrink-0">
        <Button variant="outline" size="sm" className="rounded-full px-3.5">
          <ExternalLink className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">View listing</span>
        </Button>
      </Link>
    </div>
  );
}

function MarkSoldDialog({
  thread,
  open,
  onClose,
}: {
  thread: ConversationSummary;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const markSold = useMutation({
    mutationFn: () => api.patch(`/vehicles/${thread.vehicle.id}/status`, { status: 'SOLD' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversation', thread.id] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Mark as sold?"
      description={`${thread.vehicle.title} comes off the search results. Buyers who messaged you see it as sold. You can relist it later from My listings.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={markSold.isPending} onClick={() => markSold.mutate()}>
            Mark as sold
          </Button>
        </>
      }
    >
      <ErrorAlert error={markSold.error} />
    </Dialog>
  );
}

function Composer({
  viewerRole,
  showQuickReplies,
  onSend,
}: {
  viewerRole: 'BUYER' | 'SELLER';
  showQuickReplies: boolean;
  onSend: (body: string) => void;
}) {
  const [body, setBody] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to about six lines, then scroll.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
  }, [body]);

  const send = () => {
    const text = body.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) return;
    onSend(text);
    setBody('');
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter starts a new line — unless an IME is composing.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const remaining = MAX_MESSAGE_LENGTH - body.length;

  return (
    <div className="border-t border-border px-3 pb-3 pt-2 sm:px-4">
      {showQuickReplies && !body ? (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="Quick replies">
          {QUICK_REPLIES[viewerRole].map((reply) => (
            <button
              key={reply}
              type="button"
              onClick={() => {
                setBody(reply);
                inputRef.current?.focus();
              }}
              className="h-8 shrink-0 rounded-full border border-primary/40 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {reply}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor="messenger-input" className="sr-only">
          Message
        </label>
        <textarea
          id="messenger-input"
          ref={inputRef}
          rows={1}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Aa"
          maxLength={MAX_MESSAGE_LENGTH}
          className="max-h-36 min-h-10 flex-1 resize-none rounded-[20px] border-0 bg-secondary px-4 py-2.5 text-[15px] leading-5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        />
        <button
          type="submit"
          disabled={!body.trim()}
          aria-label="Send"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground disabled:hover:bg-transparent"
        >
          <SendHorizontal className="h-5 w-5" aria-hidden />
        </button>
      </form>
      {remaining < 200 ? (
        <p className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite">
          {remaining} characters left
        </p>
      ) : null}
    </div>
  );
}

/**
 * One chat, Marketplace-style: who and which car at the top, the messages as
 * grouped bubbles with day separators and Sent / Seen under your last one,
 * and a composer with one-tap replies. A seller can mark the car sold from
 * here; either side can archive the chat for themselves.
 */
export function ConversationThread({ id }: { id: string }) {
  const user = useUser();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [confirmSold, setConfirmSold] = useState(false);

  const conversation = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`),
    // Live events arrive over the socket; this is the backstop.
    refetchInterval: 30_000,
  });

  // Opening the thread marked it read, so the counts elsewhere are stale.
  const loadedAt = conversation.dataUpdatedAt;
  useEffect(() => {
    if (!loadedAt) return;
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
  }, [loadedAt, queryClient]);

  // Switching chats leaves nothing half-sent behind from the last one.
  useEffect(() => setOutgoing([]), [id]);

  const deliver = useCallback(
    async (item: Outgoing) => {
      try {
        const message = await api.post<MessageDto>(`/conversations/${id}/messages`, {
          body: item.body,
        });
        queryClient.setQueryData<ConversationDetail>(['conversation', id], (old) =>
          old && !old.messages.some((m) => m.id === message.id)
            ? { ...old, archived: false, messages: [...old.messages, message] }
            : old,
        );
        setOutgoing((list) => list.filter((o) => o.key !== item.key));
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch {
        setOutgoing((list) => list.map((o) => (o.key === item.key ? { ...o, failed: true } : o)));
      }
    },
    [id, queryClient],
  );

  const send = (body: string) => {
    const item = { key: `${Date.now()}-${Math.random()}`, body, failed: false };
    setOutgoing((list) => [...list, item]);
    void deliver(item);
  };

  const retry = (item: Outgoing) => {
    setOutgoing((list) => list.map((o) => (o.key === item.key ? { ...o, failed: false } : o)));
    void deliver(item);
  };

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api.patch<ConversationSummary>(`/conversations/${id}/archive`, { archived }),
    onSuccess: (summary) => {
      queryClient.setQueryData<ConversationDetail>(['conversation', id], (old) =>
        old ? { ...old, archived: summary.archived } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const messages = conversation.data?.messages ?? [];
  const count = messages.length + outgoing.length;

  // Keep the newest message in view as the thread grows.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [count, id]);

  if (conversation.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label="Loading conversation" />
      </div>
    );
  }

  if (conversation.isError) {
    return (
      <div className="p-6">
        <Link
          href="/dashboard/messages"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All messages
        </Link>
        <ErrorAlert error={conversation.error} className="mt-4" />
      </div>
    );
  }

  const thread = conversation.data;
  const viewerId = user?.id;
  const days = groupThread(messages);
  const lastOwn = [...messages].reverse().find((m) => m.senderId === viewerId);
  const ownSent = messages.some((m) => m.senderId === viewerId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ThreadHeader
        thread={thread}
        onArchive={() => archive.mutate(!thread.archived)}
        archiving={archive.isPending}
      />
      <CarStrip thread={thread} onMarkSold={() => setConfirmSold(true)} />
      <ErrorAlert error={archive.error} className="m-3" />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <CarPhoto src={thread.vehicle.primaryImageUrl} className="h-20 w-20 rounded-full" />
          <p className="mt-2 font-semibold">{thread.vehicle.title}</p>
          <p className="text-sm text-muted-foreground">
            {thread.viewerRole === 'SELLER'
              ? `${thread.counterparty.displayName} is interested in your car.`
              : `You’re asking ${thread.counterparty.displayName} about this car.`}
          </p>
        </div>

        {thread.archived ? (
          <p className="mx-auto mb-4 max-w-sm rounded-xl bg-secondary px-3 py-2 text-center text-xs text-muted-foreground">
            You archived this chat. It returns to your inbox when a new message arrives.
          </p>
        ) : null}

        {days.map((block) => (
          <Fragment key={block.day}>
            <p className="my-4 text-center text-xs font-semibold text-muted-foreground">
              {dayLabel(block.day)}
            </p>
            {block.groups.map((group) => {
              const own = group.senderId === viewerId;
              return (
                <div
                  key={group.messages[0]!.id}
                  className={cn('mb-3 flex items-end gap-2', own ? 'justify-end' : 'justify-start')}
                >
                  {own ? null : (
                    <Avatar
                      id={thread.counterparty.id}
                      name={thread.counterparty.displayName}
                      className="h-7 w-7 text-[10px]"
                    />
                  )}
                  <div
                    className={cn(
                      'flex max-w-[78%] flex-col gap-0.5 sm:max-w-[70%]',
                      own ? 'items-end' : 'items-start',
                    )}
                  >
                    {group.messages.map((message, index) => (
                      <Fragment key={message.id}>
                        <p
                          title={clockTime(message.createdAt)}
                          className={cn(
                            'whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] leading-5',
                            own
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-secondary-foreground',
                            corners(own, index, group.messages.length),
                          )}
                        >
                          {message.body}
                        </p>
                        {message.id === lastOwn?.id && outgoing.length === 0 ? (
                          <span className="pr-1 text-[11px] text-muted-foreground">
                            {message.readAt ? `Seen ${clockTime(message.readAt)}` : 'Sent'}
                          </span>
                        ) : null}
                      </Fragment>
                    ))}
                  </div>
                </div>
              );
            })}
          </Fragment>
        ))}

        {outgoing.map((item) => (
          <div key={item.key} className="mb-1 flex flex-col items-end gap-0.5">
            <p
              className={cn(
                'max-w-[78%] whitespace-pre-wrap break-words rounded-[20px] bg-primary px-3.5 py-2 text-[15px] leading-5 text-primary-foreground sm:max-w-[70%]',
                item.failed ? 'opacity-50' : 'opacity-80',
              )}
            >
              {item.body}
            </p>
            {item.failed ? (
              <span className="text-[11px] text-destructive">
                Not sent ·{' '}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => retry(item)}
                >
                  Try again
                </button>
              </span>
            ) : (
              <span className="pr-1 text-[11px] text-muted-foreground">Sending…</span>
            )}
          </div>
        ))}
      </div>

      <Composer
        viewerRole={thread.viewerRole}
        showQuickReplies={!ownSent && outgoing.length === 0}
        onSend={send}
      />

      <MarkSoldDialog thread={thread} open={confirmSold} onClose={() => setConfirmSold(false)} />
    </div>
  );
}
