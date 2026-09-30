'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronLeft, Headset, User } from 'lucide-react';
import { MAX_SUPPORT_MESSAGE_LENGTH, type SupportChatDetail } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { Badge, Button, Card, CardContent, ErrorAlert, Spinner, Textarea } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AdminNav } from '@/components/admin-nav';

const ROLE_LABEL = { VISITOR: 'Visitor', ASSISTANT: 'Assistant', AGENT: 'Team' } as const;

function ChatDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['support-chat', id],
    queryFn: () => api.get<SupportChatDetail>(`/admin/support-chats/${id}`),
    // The visitor may still be typing.
    refetchInterval: 8_000,
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['support-chats'] });
    void queryClient.invalidateQueries({ queryKey: ['support-unread'] });
  };

  const send = useMutation({
    mutationFn: () =>
      api.post<SupportChatDetail>(`/admin/support-chats/${id}/messages`, { message: reply }),
    onSuccess: (next) => {
      queryClient.setQueryData(['support-chat', id], next);
      setReply('');
      refreshLists();
    },
  });

  const setStatus = useMutation({
    mutationFn: (status: 'OPEN' | 'CLOSED') =>
      api.patch<SupportChatDetail>(`/admin/support-chats/${id}`, { status }),
    onSuccess: (next) => {
      queryClient.setQueryData(['support-chat', id], next);
      refreshLists();
    },
  });

  if (isPending) return <Spinner label="Loading chat" />;
  if (!data) return <ErrorAlert error={error} />;

  const who = data.visitorName ?? data.account?.name ?? 'Website visitor';

  return (
    <>
      <Link
        href="/admin/support"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        All support chats
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card className="flex min-h-[28rem] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
            {data.messages.map((message) => {
              const visitor = message.role === 'VISITOR';
              const Icon = visitor ? User : message.role === 'AGENT' ? Headset : Bot;
              return (
                <div key={message.id} className={cn('flex gap-3', !visitor && 'flex-row-reverse')}>
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-full',
                      visitor
                        ? 'bg-secondary text-foreground'
                        : message.role === 'AGENT'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-accent/15 text-accent',
                    )}
                    aria-hidden
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className={cn('max-w-[75%]', !visitor && 'text-right')}>
                    <p className="text-xs text-muted-foreground">
                      {message.role === 'AGENT' && message.authorName
                        ? `${message.authorName} (team)`
                        : ROLE_LABEL[message.role]}{' '}
                      · {formatRelativeTime(message.createdAt)}
                    </p>
                    <p
                      className={cn(
                        'mt-1 inline-block whitespace-pre-line rounded-2xl px-3.5 py-2 text-left text-sm',
                        visitor
                          ? 'bg-secondary text-secondary-foreground'
                          : message.role === 'AGENT'
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border',
                      )}
                    >
                      {message.body}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={bottom} />
          </div>

          <form
            className="border-t border-border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (reply.trim()) send.mutate();
            }}
          >
            <Textarea
              rows={3}
              value={reply}
              maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
              placeholder={`Reply to ${who} as the Vintrax team…`}
              aria-label="Your reply"
              onChange={(event) => setReply(event.target.value)}
            />
            <ErrorAlert error={send.error} className="mt-2" />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                The visitor sees your reply in their chat. The assistant stops answering once you
                reply.
              </p>
              <Button type="submit" loading={send.isPending} disabled={!reply.trim()}>
                Send reply
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2 pt-5 text-sm">
              <p className="text-lg font-semibold">{who}</p>
              {data.visitorEmail ? (
                <a
                  href={`mailto:${data.visitorEmail}`}
                  className="block text-primary hover:underline"
                >
                  {data.visitorEmail}
                </a>
              ) : (
                <p className="text-muted-foreground">No email left.</p>
              )}
              {data.account ? (
                <p className="text-muted-foreground">Signed in as {data.account.email}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {data.humanRequested ? <Badge variant="warning">Asked for a person</Badge> : null}
                {data.agentJoined ? <Badge variant="success">Team replied</Badge> : null}
                <Badge variant={data.status === 'OPEN' ? 'primary' : 'outline'}>
                  {data.status === 'OPEN' ? 'Open' : 'Closed'}
                </Badge>
              </div>
              <p className="text-muted-foreground">Started {formatDate(data.createdAt)}</p>
              {data.pagePath ? (
                <p className="text-muted-foreground">
                  From{' '}
                  <Link href={data.pagePath} className="text-primary hover:underline">
                    {data.pagePath}
                  </Link>
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            loading={setStatus.isPending}
            onClick={() => setStatus.mutate(data.status === 'OPEN' ? 'CLOSED' : 'OPEN')}
          >
            {data.status === 'OPEN' ? 'Close chat' : 'Reopen chat'}
          </Button>
          <ErrorAlert error={setStatus.error} />
        </div>
      </div>
    </>
  );
}

export default function AdminSupportChatPage() {
  return (
    <RequireAuth adminOnly>
      <div className="container py-8">
        <AdminNav />
        <ChatDetail />
      </div>
    </RequireAuth>
  );
}
