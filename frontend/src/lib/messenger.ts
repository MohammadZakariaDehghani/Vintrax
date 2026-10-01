import type { MessageDto } from '@vintrax/shared';

/**
 * The pure parts of the messenger: how a thread is laid out, the short times
 * in the inbox, and the replies offered with one tap. Kept apart from the
 * components so they can be tested without a browser.
 */

/** Messages from one sender within this many minutes share one bubble group. */
const GROUP_GAP_MINUTES = 5;

export interface MessageGroup {
  senderId: string;
  messages: MessageDto[];
}

export interface DayBlock {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  groups: MessageGroup[];
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Splits a thread (oldest first) into days, and each day into runs of
 * consecutive messages from one person — so bubbles stack the way they do in
 * Messenger instead of every message standing alone.
 */
export function groupThread(messages: MessageDto[]): DayBlock[] {
  const days: DayBlock[] = [];
  for (const message of messages) {
    const day = localDay(message.createdAt);
    let block = days.at(-1);
    if (!block || block.day !== day) {
      block = { day, groups: [] };
      days.push(block);
    }
    const group = block.groups.at(-1);
    const previous = group?.messages.at(-1);
    const close =
      previous &&
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <=
        GROUP_GAP_MINUTES * 60_000;
    if (group && group.senderId === message.senderId && close) {
      group.messages.push(message);
    } else {
      block.groups.push({ senderId: message.senderId, messages: [message] });
    }
  }
  return days;
}

/** "Today", "Yesterday", a weekday within the week, else a date. */
export function dayLabel(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString('en-CA', { weekday: 'long' });
  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** The inbox's short time: "now", "5m", "3h", "2d", "4w", then a date. */
export function shortAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 52 * 7) return `${Math.floor(days / 7)}w`;
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short' });
}

/** Clock time for a bubble's tooltip and the "Seen" line. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

/** Replies offered with one tap, for the side of the sale the viewer is on. */
export const QUICK_REPLIES = {
  BUYER: [
    'Is this still available?',
    'Is the price negotiable?',
    'Can I book a test drive?',
    'Has it had any accidents?',
    'When could I see it?',
  ],
  SELLER: [
    'Yes, it’s still available.',
    'When would you like to see it?',
    'The price is firm, sorry.',
    'Sorry, it has been sold.',
  ],
} as const;

/** Two initials for an avatar, from a display name like "Sam O." */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
