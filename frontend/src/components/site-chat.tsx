'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Headset, Loader2, MessageCircle, SendHorizontal, X } from 'lucide-react';
import {
  MAX_SUPPORT_MESSAGE_LENGTH,
  SUPPORT_CHAT_TOKEN_HEADER,
  type StartedSupportChat,
  type SupportChatMessage,
  type SupportChatView,
} from '@vintrax/shared';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ErrorAlert } from '@/components/ui';

const STORAGE_KEY = 'vintrax.site-chat';
/** How often an open chat checks for a reply from the team. */
const POLL_MS = 6000;

interface Session {
  id: string;
  token: string;
}

function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Session>) : null;
    return parsed?.id && parsed.token ? { id: parsed.id, token: parsed.token } : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the chat still works for this page view.
  }
}

/** Site paths in a message become links; everything else stays plain text. */
function MessageText({ text }: { text: string }) {
  const parts = text.split(
    /(\/(?:vehicles|tools|register|login|contact|compare|auctions|blog|dealers|dashboard)[^\s),.]*)/g,
  );
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Link key={index} href={part} className="font-medium underline underline-offset-2">
            {part}
          </Link>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const GREETING: SupportChatMessage = {
  id: 'greeting',
  role: 'ASSISTANT',
  body: 'Hi! I’m the Vintrax assistant. Ask me about cars on Vintrax, financing, selling your car or using the site.',
  authorName: null,
  createdAt: new Date(0).toISOString(),
};

/**
 * The chat in the corner of every public page. Any visitor can ask the
 * Vintrax assistant a question; the team sees every chat under Admin →
 * Support, and can step in — their replies appear here.
 *
 * The chat is remembered on this device by an id and a random token (in
 * localStorage), so it survives page changes and reloads. Hidden in the
 * dealer portal, which has its own assistant, and in the admin area.
 */
export function SiteChat() {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [chat, setChat] = useState<SupportChatView | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [handoff, setHandoff] = useState<{ name: string; email: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The messenger is a chat of its own, and the bubble would sit on its Send button.
  const hidden =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/dealer/') ||
    pathname.startsWith('/dashboard/messages');

  useEffect(() => setSession(loadSession()), []);

  const headers = session ? { [SUPPORT_CHAT_TOKEN_HEADER]: session.token } : undefined;

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      setChat(
        await apiRequest<SupportChatView>(`/support-chat/${session.id}`, {
          method: 'GET',
          headers: { [SUPPORT_CHAT_TOKEN_HEADER]: session.token },
        }),
      );
    } catch {
      // A chat this device no longer has access to starts over.
      saveSession(null);
      setSession(null);
      setChat(null);
    }
  }, [session]);

  // Load the chat when opened, then look for team replies while it stays open.
  useEffect(() => {
    if (!open || !session) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, session, refresh]);

  const messages = [GREETING, ...(chat?.messages ?? [])];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, open, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    // Shown at once; replaced by the server's copy when the answer arrives.
    setChat((current) => ({
      id: current?.id ?? 'pending',
      status: 'OPEN',
      humanRequested: current?.humanRequested ?? false,
      agentJoined: current?.agentJoined ?? false,
      messages: [
        ...(current?.messages ?? []),
        {
          id: `local-${Date.now()}`,
          role: 'VISITOR',
          body: text,
          authorName: null,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setDraft('');
    try {
      if (session) {
        setChat(
          await apiRequest<SupportChatView>(`/support-chat/${session.id}/messages`, {
            method: 'POST',
            body: { message: text, pagePath: pathname },
            headers,
          }),
        );
      } else {
        const started = await apiRequest<StartedSupportChat>('/support-chat', {
          method: 'POST',
          body: { message: text, pagePath: pathname },
        });
        const next = { id: started.id, token: started.token };
        saveSession(next);
        setSession(next);
        setChat(started);
      }
    } catch (caught) {
      setError(caught);
      setDraft(text);
      void refresh();
    } finally {
      setSending(false);
    }
  }

  async function requestHuman() {
    if (!session || !handoff) return;
    setSending(true);
    setError(null);
    try {
      setChat(
        await apiRequest<SupportChatView>(`/support-chat/${session.id}/human`, {
          method: 'POST',
          body: { name: handoff.name || null, email: handoff.email || null },
          headers,
        }),
      );
      setHandoff(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setSending(false);
    }
  }

  function startOver() {
    saveSession(null);
    setSession(null);
    setChat(null);
    setHandoff(null);
    setError(null);
  }

  if (hidden) return null;

  return (
    <div className="pointer-events-none relative flex justify-end px-4 pb-4">
      {open ? (
        <section
          aria-label="Chat with Vintrax"
          className="pointer-events-auto absolute bottom-full right-4 mb-1 flex h-[min(560px,calc(100vh-7rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        >
          <header className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              V
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight">Vintrax</p>
              <p className="text-xs text-muted-foreground">
                {chat?.agentJoined
                  ? 'You’re chatting with the team'
                  : 'Assistant · the team can also help'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Close chat"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div
            ref={scroller}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {messages.map((message) => {
              const mine = message.role === 'VISITOR';
              return (
                <div
                  key={message.id}
                  className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}
                >
                  {message.role === 'AGENT' ? (
                    <span className="mb-1 text-xs font-medium text-muted-foreground">
                      {message.authorName} · Vintrax team
                    </span>
                  ) : null}
                  <p
                    className={cn(
                      'max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm',
                      mine
                        ? 'rounded-br-md bg-primary text-primary-foreground'
                        : 'rounded-bl-md bg-secondary text-secondary-foreground',
                    )}
                  >
                    <MessageText text={message.body} />
                  </p>
                </div>
              );
            })}
            {sending ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Typing…
              </div>
            ) : null}
          </div>

          <div className="border-t border-border px-3 pb-3 pt-2">
            <ErrorAlert error={error} className="mb-2" />

            {handoff ? (
              <form
                className="mb-2 space-y-2 rounded-lg border border-border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void requestHuman();
                }}
              >
                <p className="text-xs text-muted-foreground">
                  How should the team reach you if you leave? Both optional.
                </p>
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  placeholder="Your name"
                  maxLength={120}
                  value={handoff.name}
                  onChange={(event) => setHandoff({ ...handoff, name: event.target.value })}
                  aria-label="Your name"
                />
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  placeholder="Email"
                  type="email"
                  maxLength={254}
                  value={handoff.email}
                  onChange={(event) => setHandoff({ ...handoff, email: event.target.value })}
                  aria-label="Your email"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="px-2 text-sm text-muted-foreground"
                    onClick={() => setHandoff(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={sending}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
                  >
                    Ask the team
                  </button>
                </div>
              </form>
            ) : session && chat && !chat.humanRequested && !chat.agentJoined ? (
              <button
                type="button"
                onClick={() => setHandoff({ name: '', email: '' })}
                className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                <Headset className="h-3.5 w-3.5" aria-hidden />
                Talk to the team
              </button>
            ) : null}

            <form
              className="flex items-end gap-2 rounded-xl border border-input bg-background px-3 py-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <textarea
                rows={1}
                value={draft}
                maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
                placeholder="Message…"
                aria-label="Your message"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                className="max-h-28 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                aria-label="Send"
              >
                <SendHorizontal className="h-4 w-4" aria-hidden />
              </button>
            </form>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>AI answers can be wrong. Don’t share personal details.</span>
              {session ? (
                <button
                  type="button"
                  onClick={startOver}
                  className="shrink-0 hover:text-foreground hover:underline"
                >
                  New chat
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Close chat' : 'Chat with Vintrax'}
        className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden />
        ) : (
          <MessageCircle className="h-6 w-6" aria-hidden />
        )}
      </button>
    </div>
  );
}
