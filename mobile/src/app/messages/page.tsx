'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useConversations } from '@/lib/queries';
import { formatRelativeTime } from '@/lib/format';
import { Button, Card, Skeleton, StateMessage } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { RequireAuth } from '@/components/require-auth';
import { ErrorState } from '@/components/error-state';

export default function MessagesPage() {
  return (
    <>
      <AppBar title="Messages" />
      <RequireAuth>
        <ConversationList />
      </RequireAuth>
    </>
  );
}

function ConversationList() {
  const router = useRouter();
  const conversations = useConversations();
  const items = conversations.data?.items ?? [];

  if (conversations.isPending) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (conversations.isError) {
    return <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />;
  }

  if (items.length === 0) {
    return (
      <StateMessage
        title="No conversations"
        description="Message a seller from any listing and the thread appears here."
        action={<Button onClick={() => router.push('/browse')}>Browse inventory</Button>}
      />
    );
  }

  return (
    <ul className="space-y-2 p-3">
      {items.map((conversation) => (
        <li key={conversation.id}>
          <Link href={`/messages/${conversation.id}`} className="block active:opacity-90">
            <Card className="space-y-1 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-semibold">{conversation.vehicle.title}</p>
                {conversation.unreadCount > 0 ? (
                  <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {conversation.unreadCount}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {conversation.lastMessage?.body ?? 'No messages yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                {conversation.counterparty.displayName}
                {conversation.lastMessage
                  ? ` · ${formatRelativeTime(conversation.lastMessage.createdAt)}`
                  : ''}
              </p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
