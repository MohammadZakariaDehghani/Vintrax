import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PROVINCE_LABELS, labelize, type Province } from '@atlas/shared';

/** Merges Tailwind classes, letting later classes win over earlier conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const cadFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-CA');
const compactFormatter = new Intl.NumberFormat('en-CA', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatPrice = (cad: number): string => cadFormatter.format(cad);
export const formatCompact = (value: number): string => compactFormatter.format(value);
export const formatNumber = (value: number): string => numberFormatter.format(value);
export const formatKm = (km: number): string => `${numberFormatter.format(km)} km`;
export const formatProvince = (province: Province): string => PROVINCE_LABELS[province];
export const formatLocation = (city: string, province: Province): string => `${city}, ${province}`;
export const formatEnum = (value: string): string => labelize(value);

/** "41,200 km · Automatic · Gasoline" style specification line. */
export const joinSpecs = (...parts: Array<string | null | undefined>): string =>
  parts.filter((part): part is string => Boolean(part)).join(' · ');

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Relative time for messages and listings. Falls back to an absolute date
 * beyond a week, where "8 days ago" stops being more useful than the date.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMinutes = Math.round((now.getTime() - then.getTime()) / 60_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays <= 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return then.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Countdown for auctions, e.g. "2d 04h", "3h 12m", "45s".
 *
 * Deliberately coarse above an hour and precise below it: the last minute is
 * when precision matters to a bidder.
 */
export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'Ended';

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** True when an auction is close enough that the UI should convey urgency. */
export const isClosingSoon = (secondsRemaining: number): boolean =>
  secondsRemaining > 0 && secondsRemaining <= 15 * 60;
