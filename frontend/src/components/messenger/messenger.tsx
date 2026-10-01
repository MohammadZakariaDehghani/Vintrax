'use client';

import { useCallback, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import type { ConversationDetail, MessagingEvent } from '@vintrax/shared';
import { cn } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { useMessagingSocket } from '@/hooks/use-messaging-socket';
import { DashboardNav } from '@/components/dashboard-nav';
import { ConversationList } from './conversation-list';

/**
 * Applies a live event to what is already on screen. A new message is added
 * to its thread straight away and the inbox refetches; "seen" flips the
 * viewer's own messages without asking the API at all.
 */
function useLiveUpdates(selectedId: string | undefined) {
  const queryClient = useQueryClient();
  const viewerId = useUser()?.id;

  return useCallback(
    (event: MessagingEvent) => {
      const key = ['conversation', event.conversationId];
      if (event.type === 'message:new') {
        queryClient.setQueryData<ConversationDetail>(key, (old) =>
          old && !old.messages.some((m) => m.id === event.message.id)
            ? { ...old, messages: [...old.messages, event.message] }
            : old,
        );
        // The open thread refetches so the message is marked read — which is
        // what turns the sender's "Sent" into "Seen".
        if (event.conversationId === selectedId && event.message.senderId !== viewerId) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
        return;
      }
      queryClient.setQueryData<ConversationDetail>(key, (old) =>
        old
          ? {
              ...old,
              messages: old.messages.map((m) =>
                m.senderId !== event.readerId && !m.readAt && m.createdAt <= event.readAt
                  ? { ...m, readAt: event.readAt }
                  : m,
              ),
            }
          : old,
      );
    },
    [queryClient, selectedId, viewerId],
  );
}

/** The right-hand pane before a chat is chosen (computer width only). */
export function NoThreadSelected() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-primary">
          <MessagesSquare className="h-7 w-7" aria-hidden />
        </span>
        <p className="mt-4 text-lg font-semibold">Your messages</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          Choose a chat to read it and reply. Buyers’ questions about your cars, and your questions
          to sellers, all land here.
        </p>
      </div>
    </div>
  );
}

/**
 * The messenger, laid out like Marketplace's: the inbox on the left and the
 * open chat on the right. It wraps every /dashboard/messages route as a
 * layout, so moving between chats keeps the inbox, its scroll position and
 * the one live connection. On a phone only one pane shows at a time.
 */
export function Messenger({ children }: { children: ReactNode }) {
  const params = useParams<{ id?: string }>();
  const selectedId = params.id;
  const user = useUser();

  useMessagingSocket(Boolean(user), useLiveUpdates(selectedId));

  return (
    <div className="container py-6 md:py-8">
      <div className="hidden md:block">
        <DashboardNav />
      </div>
      <div className="flex h-[calc(100dvh-8.5rem)] min-h-[480px] overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:h-[calc(100dvh-13rem)] md:min-h-[540px]">
        <aside
          className={cn(
            'min-h-0 w-full shrink-0 flex-col border-border md:flex md:w-[340px] md:border-r lg:w-[380px]',
            selectedId ? 'hidden' : 'flex',
          )}
          aria-label="Chats"
        >
          <ConversationList selectedId={selectedId} />
        </aside>
        <section
          className={cn('min-h-0 min-w-0 flex-1 flex-col md:flex', selectedId ? 'flex' : 'hidden')}
          aria-label="Chat"
        >
          {children}
        </section>
      </div>
    </div>
  );
}
