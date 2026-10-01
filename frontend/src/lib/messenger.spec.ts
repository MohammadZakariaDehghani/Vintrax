import { describe, expect, it } from 'vitest';
import type { MessageDto } from '@vintrax/shared';
import { dayLabel, groupThread, initials, shortAgo } from './messenger';

const message = (id: string, senderId: string, createdAt: string): MessageDto => ({
  id,
  conversationId: 'c1',
  senderId,
  body: id,
  readAt: null,
  createdAt: new Date(createdAt).toISOString(),
});

describe('groupThread', () => {
  it('stacks consecutive messages from one person, a few minutes apart', () => {
    const days = groupThread([
      message('a', 'buyer', '2026-05-01T10:00:00'),
      message('b', 'buyer', '2026-05-01T10:02:00'),
      message('c', 'seller', '2026-05-01T10:03:00'),
      message('d', 'buyer', '2026-05-01T10:04:00'),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0]!.groups.map((g) => g.messages.map((m) => m.id))).toEqual([
      ['a', 'b'],
      ['c'],
      ['d'],
    ]);
  });

  it('starts a new group after a pause, and a new block on a new day', () => {
    const days = groupThread([
      message('a', 'buyer', '2026-05-01T10:00:00'),
      message('b', 'buyer', '2026-05-01T10:30:00'),
      message('c', 'buyer', '2026-05-02T09:00:00'),
    ]);
    expect(days.map((d) => d.day)).toEqual(['2026-05-01', '2026-05-02']);
    expect(days[0]!.groups).toHaveLength(2);
  });
});

describe('dayLabel', () => {
  const now = new Date(2026, 4, 6, 12); // Wednesday 6 May 2026
  it('names today, yesterday and this week', () => {
    expect(dayLabel('2026-05-06', now)).toBe('Today');
    expect(dayLabel('2026-05-05', now)).toBe('Yesterday');
    expect(dayLabel('2026-05-02', now)).toMatch(/Saturday/);
  });
  it('dates anything older', () => {
    expect(dayLabel('2026-04-01', now)).toMatch(/Apr/);
    expect(dayLabel('2025-04-01', now)).toMatch(/2025/);
  });
});

describe('shortAgo', () => {
  const now = new Date('2026-05-06T12:00:00Z');
  it('uses Marketplace-style short units', () => {
    expect(shortAgo('2026-05-06T11:59:40Z', now)).toBe('now');
    expect(shortAgo('2026-05-06T11:55:00Z', now)).toBe('5m');
    expect(shortAgo('2026-05-06T09:00:00Z', now)).toBe('3h');
    expect(shortAgo('2026-05-04T12:00:00Z', now)).toBe('2d');
    expect(shortAgo('2026-04-15T12:00:00Z', now)).toBe('3w');
  });
});

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Sam O.')).toBe('SO');
    expect(initials('Northshore Motors Ltd')).toBe('NL');
    expect(initials('bea')).toBe('BE');
  });
});
