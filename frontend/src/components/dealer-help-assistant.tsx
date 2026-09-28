'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BookOpen, CircleHelp, SendHorizontal, X } from 'lucide-react';
import {
  MAX_HELP_HISTORY,
  MAX_HELP_MESSAGE_LENGTH,
  type HelpChatInput,
  type HelpChatReply,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { useIsSeller, useUser } from '@/store/auth-store';
import { Button, ErrorAlert } from '@/components/ui';
import { cn } from '@/lib/utils';

const OPEN_EVENT = 'vintrax:dealer-help';

/** Opens the assistant from anywhere in the portal, such as the Help entry in the portal nav. */
export function openDealerHelp() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The starter questions, phrased the way a dealer would ask them. */
const QUICK_QUESTIONS: Array<{ label: string; question: string }> = [
  { label: 'Search inventory', question: 'How do I search and filter my inventory?' },
  { label: 'Upload inventory', question: 'How do I upload inventory with a CSV?' },
  { label: 'Manage vehicle costs', question: 'How do I add a vehicle cost?' },
  { label: 'Edit a vehicle', question: 'How do I edit a vehicle?' },
  { label: 'Understanding dashboard', question: 'What do the dashboard numbers mean?' },
];

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  reply?: HelpChatReply;
}

/**
 * The dealer help assistant: a button in the bottom-right corner of every
 * dealer portal page, opening a small chat panel.
 *
 * Only questions and answers pass through it. The browser talks to the
 * Vintrax API, which holds any AI provider credentials; nothing here knows
 * which provider (if any) is configured. Answers are rendered as text, never
 * as HTML.
 */
export function DealerHelpAssistant() {
  const user = useUser();
  const isSeller = useIsSeller();
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  const ask = useMutation({
    mutationFn: (input: HelpChatInput) => api.post<HelpChatReply>('/dealer/help/chat', input),
    onSuccess: (reply) =>
      setTurns((current) => [...current, { role: 'assistant', content: reply.answer, reply }]),
  });

  if (!user || !isSeller) return null;

  function send(question: string) {
    const message = question.trim().slice(0, MAX_HELP_MESSAGE_LENGTH);
    if (!message || ask.isPending) return;
    const history = turns
      .slice(-MAX_HELP_HISTORY)
      .map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
    setTurns((current) => [...current, { role: 'user', content: message }]);
    setText('');
    ask.mutate({ message, history, page: pathname.slice(0, 200) });
  }

  return (
    <>
      {open ? (
        <section
          role="dialog"
          aria-label="Vintrax Dealer Assistant"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          className="fixed inset-x-2 bottom-20 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[400px]"
        >
          <header className="flex items-center justify-between gap-3 bg-header px-4 py-3 text-header-foreground">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground">
                <CircleHelp className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold leading-tight">Vintrax Dealer Assistant</p>
                <p className="text-xs opacity-70">Help with the dealer portal</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 opacity-80 hover:bg-white/10 hover:opacity-100"
              aria-label="Close the assistant"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
            <div className="rounded-lg bg-secondary px-3 py-2 text-sm">Hi! How can I help you?</div>

            {turns.length === 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_QUESTIONS.map((entry) => (
                  <button
                    key={entry.label}
                    type="button"
                    onClick={() => send(entry.question)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            ) : null}

            <ol className="mt-3 flex flex-col gap-3">
              {turns.map((turn, index) => (
                <li
                  key={index}
                  className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[88%] whitespace-pre-line rounded-lg px-3 py-2 text-sm',
                      turn.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-background',
                    )}
                  >
                    {turn.content}
                    {turn.reply ? <ReplyFooter reply={turn.reply} /> : null}
                  </div>
                </li>
              ))}
              {ask.isPending ? (
                <li className="text-xs text-muted-foreground" role="status">
                  Looking that up…
                </li>
              ) : null}
            </ol>
            <ErrorAlert error={ask.error} className="mt-3" />
            <div ref={endRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send(text);
            }}
          >
            <label htmlFor="dealer-help-input" className="sr-only">
              Your question
            </label>
            <textarea
              id="dealer-help-input"
              ref={inputRef}
              rows={1}
              maxLength={MAX_HELP_MESSAGE_LENGTH}
              value={text}
              placeholder="Type your question…"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send(text);
                }
              }}
              className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="icon" disabled={!text.trim()} loading={ask.isPending}>
              {ask.isPending ? null : <SendHorizontal className="h-4 w-4" aria-hidden />}
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? 'Close the dealer assistant' : 'Open the dealer assistant'}
        className="fixed bottom-4 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden />
        ) : (
          <CircleHelp className="h-7 w-7" aria-hidden />
        )}
      </button>
    </>
  );
}

function ReplyFooter({ reply }: { reply: HelpChatReply }) {
  if (reply.mode === 'fallback') {
    return (
      <p className="mt-2 text-xs">
        <Link href="/contact" className="font-medium text-primary hover:underline">
          Contact Vintrax support
        </Link>
      </p>
    );
  }

  // Only in-app paths become links. A source is the server's, but a link is
  // still only followed when it stays on this site.
  const links = reply.sources.filter((source) => source.href?.startsWith('/'));

  return (
    <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
      {reply.mode === 'articles' ? (
        <p className="flex items-center gap-1">
          <BookOpen className="h-3 w-3" aria-hidden />
          From the Vintrax dealer help
        </p>
      ) : null}
      {links.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {links.map((source) => (
            <li key={source.id}>
              <Link href={source.href!} className="font-medium text-primary hover:underline">
                {source.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
