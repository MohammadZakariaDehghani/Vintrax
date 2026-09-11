'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { vintrax } from '@/lib/vintrax';
import { keys, useConversation } from '@/lib/queries';
import { useUser } from '@/store/session';
import { cn, formatRelativeTime } from '@/lib/format';
import { Button, Spinner } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { RequireAuth } from '@/components/require-auth';
import { ErrorState } from '@/components/error-state';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <Thread id={id} />
    </RequireAuth>
  );
}

function Thread({ id }: { id: string }) {
  const user = useUser();
  const queryClient = useQueryClient();
  const conversation = useConversation(id);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = conversation.data?.messages ?? [];

  useEffect(() => {
    // New messages arrive at the bottom, which is where a phone conversation
    // is read from.
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (conversation.isPending) {
    return (
      <>
        <AppBar title="Conversation" back />
        <Spinner label="Loading conversation" />
      </>
    );
  }

  if (conversation.isError) {
    return (
      <>
        <AppBar title="Conversation" back />
        <ErrorState error={conversation.error} onRetry={() => void conversation.refetch()} />
      </>
    );
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;

    setSending(true);
    setError(null);
    try {
      await vintrax.conversations.reply(id, text);
      setBody('');
      await queryClient.invalidateQueries({ queryKey: keys.conversation(id) });
      await queryClient.invalidateQueries({ queryKey: keys.conversations });
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Message not sent'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <AppBar title={conversation.data.vehicle.title} back />

      <div className="space-y-3 p-3">
        {messages.map((message) => {
          const own = message.senderId === user?.id;
          return (
            <div key={message.id} className={cn('flex', own ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3.5 py-2.5',
                  own
                    ? 'rounded-br-sm bg-primary text-primary-foreground'
                    : 'rounded-bl-sm bg-secondary text-secondary-foreground',
                )}
              >
                <p className="whitespace-pre-line text-sm">{message.body}</p>
                <p
                  className={cn(
                    'pt-1 text-[0.6875rem]',
                    own ? 'opacity-75' : 'text-muted-foreground',
                  )}
                >
                  {formatRelativeTime(message.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={send}
        className="sticky bottom-0 flex items-end gap-2 border-t border-border bg-card p-2"
      >
        <label htmlFor="message-body" className="sr-only">
          Message
        </label>
        <textarea
          id="message-body"
          rows={1}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message"
          className="min-h-touch flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-base"
        />
        <Button type="submit" loading={sending} disabled={!body.trim()} aria-label="Send message">
          <Send aria-hidden className="h-4 w-4" />
        </Button>
      </form>

      {error ? (
        <p role="alert" className="px-4 pb-3 text-sm font-medium text-destructive">
          {error.message}
        </p>
      ) : null}
    </>
  );
}
