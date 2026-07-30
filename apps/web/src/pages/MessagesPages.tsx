import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConversationDetail,
  ConversationSummary,
  MessageDto,
  Paginated,
} from '@atlas/shared';
import { api } from '../lib/api-client';
import { useAuth } from '../auth/auth-context';
import { EmptyState, ErrorAlert, Spinner } from '../components/ui';
import { formatPrice, formatRelativeTime } from '../lib/format';

function ConversationList({ activeId }: { activeId?: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<Paginated<ConversationSummary>>('/conversations?pageSize=50'),
  });

  if (isPending) return <Spinner label="Loading conversations" />;
  if (!data?.items.length) {
    return (
      <EmptyState title="No messages yet">
        When you contact a seller, the conversation appears here.
      </EmptyState>
    );
  }

  return (
    <ul className="conversation-list">
      {data.items.map((conversation) => (
        <li className="conversation-item" key={conversation.id}>
          <Link
            to={`/messages/${conversation.id}`}
            className="conversation-link"
            aria-current={conversation.id === activeId}
          >
            {conversation.listing.primaryImageUrl ? (
              <img
                src={conversation.listing.primaryImageUrl}
                alt=""
                className="conversation-thumb"
              />
            ) : (
              <span className="conversation-thumb" />
            )}

            <span className="conversation-preview">
              <span className="conversation-name">
                {conversation.unreadCount > 0 ? <span className="unread-dot" /> : null}
                {conversation.counterparty.displayName}
              </span>
              <p>{conversation.listing.title}</p>
              <p style={{ opacity: 0.85 }}>
                {conversation.lastMessage?.body ?? 'No messages yet'}
              </p>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MessageThread({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${conversationId}`),
    // Opening a thread marks it read server-side, so the badge must refresh.
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (data) {
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
    // Only when the thread identity or message count changes, not on every render.
  }, [conversationId, data?.messages.length, queryClient, data]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

  const reply = useMutation({
    mutationFn: (body: string) =>
      api.post<MessageDto>(`/conversations/${conversationId}/messages`, { body }),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  if (isPending) return <Spinner label="Loading conversation" />;
  if (error) return <ErrorAlert error={error} />;
  if (!data) return null;

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 style={{ marginBottom: '0.2rem' }}>{data.counterparty.displayName}</h2>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            <Link to={`/listings/${data.listing.id}`}>{data.listing.title}</Link> ·{' '}
            {formatPrice(data.listing.priceCad)}
          </p>
        </div>
      </div>

      <div className="message-thread">
        {data.messages.map((message) => {
          const mine = message.senderId === user?.id;
          return (
            <div key={message.id} className={`message-bubble ${mine ? 'from-me' : 'from-them'}`}>
              {message.body}
              <span className="message-time">{formatRelativeTime(message.createdAt)}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <ErrorAlert error={reply.error} />

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) reply.mutate(draft.trim());
        }}
      >
        <div style={{ flex: 1 }}>
          <label htmlFor="reply-body" className="visually-hidden">
            Write a reply
          </label>
          <textarea
            id="reply-body"
            value={draft}
            maxLength={4000}
            placeholder="Write a reply…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (draft.trim()) reply.mutate(draft.trim());
              }
            }}
          />
        </div>
        <button type="submit" className="btn" disabled={reply.isPending || !draft.trim()}>
          {reply.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

export function InboxPage() {
  const { id } = useParams();

  return (
    <>
      <h1>Messages</h1>
      <div className="inbox-layout">
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <ConversationList activeId={id} />
        </div>

        {id ? (
          <MessageThread conversationId={id} />
        ) : (
          <div className="panel">
            <EmptyState title="Select a conversation">
              Choose a conversation on the left to read and reply.
            </EmptyState>
          </div>
        )}
      </div>
    </>
  );
}
