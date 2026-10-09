import { BadRequestException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import type { ReviewFlag, ReviewSort } from '@vintrax/shared';

/**
 * The review system's small pure pieces: privacy-safe identifiers, the
 * duplicate fingerprint, moderator flags and the pagination cursor.
 */

/**
 * An HMAC of a network address or user agent. The raw value is never stored:
 * the hash is enough to count and match submissions from one source, and
 * cannot be reversed into an address without the server's key.
 */
export function sourceHash(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/** The duplicate fingerprint: the text without case, punctuation or spacing. */
export function contentHash(content: string): string {
  const folded = content
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return createHash('sha256').update(folded).digest('hex');
}

const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|ca|net|org|io|co|info|biz)\b/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/** Signals for the moderator to look at. They never publish or reject a review. */
export function contentFlags(content: string): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (LINK.test(content)) flags.push('LINKS');
  if (EMAIL.test(content) || PHONE.test(content)) flags.push('CONTACT_DETAILS');
  const letters = content.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 20 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.7) {
    flags.push('SHOUTING');
  }
  if (/(.)\1{5,}/u.test(content)) flags.push('REPEATED_CHARACTERS');
  return flags;
}

export interface ReviewCursor {
  rating: number;
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: ReviewCursor): string {
  return Buffer.from(
    JSON.stringify({ r: cursor.rating, c: cursor.createdAt.toISOString(), i: cursor.id }),
  ).toString('base64url');
}

export function decodeCursor(value: string): ReviewCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      r: unknown;
      c: unknown;
      i: unknown;
    };
    const createdAt = new Date(String(parsed.c));
    if (
      typeof parsed.r !== 'number' ||
      !Number.isInteger(parsed.r) ||
      parsed.r < 1 ||
      parsed.r > 5 ||
      Number.isNaN(createdAt.getTime()) ||
      typeof parsed.i !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(parsed.i)
    ) {
      throw new Error('bad cursor');
    }
    return { rating: parsed.r, createdAt, id: parsed.i };
  } catch {
    throw new BadRequestException('That page link is no longer valid; reload the reviews');
  }
}

/** Prisma ordering for each public sort; `id` breaks ties so the order is total. */
export function sortOrder(sort: ReviewSort) {
  const recent = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  if (sort === 'HIGHEST') return [{ rating: 'desc' as const }, ...recent];
  if (sort === 'LOWEST') return [{ rating: 'asc' as const }, ...recent];
  return recent;
}

/** The rows strictly after the cursor in the given sort (keyset pagination). */
export function afterCursor(sort: ReviewSort, cursor: ReviewCursor) {
  const sameRatingAfter = {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
  if (sort === 'RECENT') return sameRatingAfter;
  return {
    OR: [
      { rating: sort === 'HIGHEST' ? { lt: cursor.rating } : { gt: cursor.rating } },
      { rating: cursor.rating, ...sameRatingAfter },
    ],
  };
}
