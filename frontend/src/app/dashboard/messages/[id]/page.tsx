'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import type { ConversationDetail, MessageDto } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatPrice, formatRelativeTime } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { Button, Card, CardContent, ErrorAlert, Spinner, Textarea } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';

function Thread({ id }: { id: string }) {
  const user = useUser();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const conversation = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`),
    // Opening the thread marks incoming messages read, so the unread badge in
    // the header is stale the moment this resolves.
    refetchInterval: 20_000,
  });

  const messages = conversation.data?.messages ?? [];

  useEffect(() => {
    if (messages.length > 0) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    if (!conversation.data) return;
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
  }, [conversation.data, queryClient]);

  const send = useMutation({
    mutationFn: (text: string) =>
      api.post<MessageDto>(`/conversations/${id}/messages`, { body: text }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['conversation', id] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  if (conversation.isPending) return <Spinner label="Loading conversation" />;

  if (conversation.isError) {
    return (
      <div className="container py-8">
        <BackLink />
        <ErrorAlert error={conversation.error} className="mt-4" />
      </div>
    );
  }

  const thread = conversation.data;

  return (
    <div className="container max-w-3xl py-8">
      <BackLink />

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
          <div className="min-w-0">
            <Link
              href={`/vehicles/${thread.vehicle.id}`}
              className="font-semibold text-primary hover:underline"
            >
              {thread.vehicle.title}
            </Link>
            <p className="mt-0.5 text-sm text-muted-foreground">
              With {thread.counterparty.displayName}
            </p>
          </div>
          <p className="tabular text-lg font-bold">{formatPrice(thread.vehicle.priceCad)}</p>
        </CardContent>
      </Card>

      <ol className="mt-6 flex flex-col gap-3">
        {messages.map((message) => {
          const own = message.senderId === user?.id;
          return (
            <li key={message.id} className={cn('flex', own ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5',
                  own
                    ? 'rounded-br-sm bg-primary text-primary-foreground'
                    : 'rounded-bl-sm bg-secondary text-secondary-foreground',
                )}
              >
                <p className="whitespace-pre-line text-sm">{message.body}</p>
                <p className={cn('pt-1 text-xs', own ? 'opacity-75' : 'text-muted-foreground')}>
                  {formatRelativeTime(message.createdAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={endRef} />

      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const text = body.trim();
          if (text) send.mutate(text);
        }}
      >
        <label htmlFor="reply" className="sr-only">
          Message
        </label>
        <Textarea
          id="reply"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a reply"
        />
        <ErrorAlert error={send.error} />
        <div className="flex justify-end">
          <Button type="submit" disabled={!body.trim() || send.isPending}>
            <Send className="mr-2 h-4 w-4" aria-hidden />
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/messages"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      All messages
    </Link>
  );
}

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <Thread id={id} />
    </RequireAuth>
  );
}
