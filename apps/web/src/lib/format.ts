import { PROVINCE_LABELS, labelize, type Province } from '@atlas/shared';

const cadFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-CA');

export const formatPrice = (cad: number): string => cadFormatter.format(cad);

export const formatKm = (km: number): string => `${numberFormatter.format(km)} km`;

export const formatProvince = (province: Province): string => PROVINCE_LABELS[province];

export const formatLocation = (city: string, province: Province): string => `${city}, ${province}`;

/** Enum-to-label for display, e.g. PLUG_IN_HYBRID -> "Plug in hybrid". */
export const formatEnum = (value: string): string => labelize(value);

/**
 * Relative time for message and listing timestamps. Falls back to an absolute
 * date beyond a week, where "8 days ago" stops being more useful than the date.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays <= 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return then.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** "2022 Toyota RAV4 · 41,200 km · Automatic" style specification line. */
export const joinSpecs = (...parts: Array<string | null | undefined>): string =>
  parts.filter((part): part is string => Boolean(part)).join(' · ');
