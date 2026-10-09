import { normalizeReviewText, reviewCreateSchema } from '@vintrax/shared';
import {
  contentFlags,
  contentHash,
  decodeCursor,
  encodeCursor,
  sourceHash,
} from './review-signals';

describe('review text', () => {
  it('trims, collapses whitespace and keeps at most one blank line', () => {
    expect(normalizeReviewText('  Great\t\t car.\r\n\r\n\r\n\r\nClean   inside.  ')).toBe(
      'Great car.\n\nClean inside.',
    );
  });

  it('removes tags and invisible characters, leaving the words', () => {
    expect(
      normalizeReviewText('<script>alert(1)</script>Nice <b>car</b><img src=x onerror=alert(1)>'),
    ).toBe('alert(1)Nice car');
    expect(normalizeReviewText('Good​ car\u0007 here')).toBe('Good car here');
    // A lone angle bracket is text, not a tag.
    expect(normalizeReviewText('Price < 20k and > expected')).toBe('Price < 20k and > expected');
  });

  it('measures length after normalising', () => {
    expect(
      reviewCreateSchema.safeParse({
        rating: 3,
        content: `${' '.repeat(50)}short${' '.repeat(50)}`,
      }).success,
    ).toBe(false);
    expect(
      reviewCreateSchema.safeParse({ rating: 3, content: '<b></b><i></i>          ' }).success,
    ).toBe(false);
    expect(reviewCreateSchema.safeParse({ rating: 3, content: 'Ten chars!' }).success).toBe(true);
  });
});

describe('review signals', () => {
  it('fingerprints text without case, spacing or punctuation', () => {
    expect(contentHash('Great car, very clean!')).toBe(contentHash('great  CAR very clean'));
    expect(contentHash('Great car')).not.toBe(contentHash('Great cat'));
  });

  it('hashes an address with a key, never returning it', () => {
    const hash = sourceHash('key', 'ip:203.0.113.5');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(sourceHash('other-key', 'ip:203.0.113.5'));
  });

  it('flags links, contact details, shouting and repeated characters', () => {
    expect(contentFlags('Visit www.cheap-cars.example now')).toContain('LINKS');
    expect(contentFlags('Call me at 416-555-0199 about it')).toContain('CONTACT_DETAILS');
    expect(contentFlags('Email me: someone@example.com')).toContain('CONTACT_DETAILS');
    expect(contentFlags('THIS IS THE WORST CAR I HAVE EVER SEEN')).toContain('SHOUTING');
    expect(contentFlags('Sooooooo good')).toContain('REPEATED_CHARACTERS');
    expect(contentFlags('A perfectly ordinary, helpful review.')).toEqual([]);
  });

  it('round-trips a cursor and refuses a tampered one', () => {
    const cursor = {
      rating: 4,
      createdAt: new Date('2026-10-01T12:00:00Z'),
      id: '6c1f3f0e-6f43-4c5b-9b0a-3b1d6f9a2b11',
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(() => decodeCursor('not-a-cursor')).toThrow(/no longer valid/);
    const bad = Buffer.from(JSON.stringify({ r: 9, c: 'x', i: "1' OR 1=1" })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(/no longer valid/);
  });
});
