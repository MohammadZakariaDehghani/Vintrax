import type { CrmRangePreset } from '@vintrax/shared';

/**
 * Dates in the dealership's own time zone. "Today", "this month" and the send
 * window are the dealer's local ones, wherever the server runs; everything is
 * stored in UTC.
 */

interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at that instant (Toronto in winter: -300). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/** The UTC instant of a local wall-clock time in the zone. */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
  minute = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset across a daylight-saving change.
  let instant = new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60_000);
  instant = new Date(guess - offsetMinutes(instant, timeZone) * 60_000);
  return instant;
}

export function startOfLocalDay(instant: Date, timeZone: string): Date {
  const p = localParts(instant, timeZone);
  return zonedTime(p.year, p.month, p.day, 0, timeZone);
}

export function addDaysLocal(instant: Date, days: number, timeZone: string): Date {
  const p = localParts(instant, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    p.hour,
    timeZone,
    p.minute,
  );
}

/** A date-only string (YYYY-MM-DD) as the start of that local day. */
export function localDate(iso: string, timeZone: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return zonedTime(year, month, day, 0, timeZone);
}

export interface DateRange {
  from: Date;
  /** Exclusive. */
  to: Date;
  /** The same length immediately before, for comparisons. */
  previousFrom: Date;
  label: string;
}

/** Resolves a range preset in the dealer's zone. */
export function resolveRange(
  preset: CrmRangePreset,
  timeZone: string,
  custom: { from?: string; to?: string } = {},
  now = new Date(),
): DateRange {
  const p = localParts(now, timeZone);
  const day = (y: number, m: number, d: number) => {
    const normalized = new Date(Date.UTC(y, m - 1, d));
    return zonedTime(
      normalized.getUTCFullYear(),
      normalized.getUTCMonth() + 1,
      normalized.getUTCDate(),
      0,
      timeZone,
    );
  };
  let from: Date;
  let to: Date;
  switch (preset) {
    case 'TODAY':
      from = day(p.year, p.month, p.day);
      to = day(p.year, p.month, p.day + 1);
      break;
    case 'THIS_WEEK': {
      // Weeks start on Monday.
      const back = (p.weekday + 6) % 7;
      from = day(p.year, p.month, p.day - back);
      to = day(p.year, p.month, p.day - back + 7);
      break;
    }
    case 'LAST_MONTH':
      from = day(p.year, p.month - 1, 1);
      to = day(p.year, p.month, 1);
      break;
    case 'THIS_QUARTER': {
      const first = Math.floor((p.month - 1) / 3) * 3 + 1;
      from = day(p.year, first, 1);
      to = day(p.year, first + 3, 1);
      break;
    }
    case 'THIS_YEAR':
      from = day(p.year, 1, 1);
      to = day(p.year + 1, 1, 1);
      break;
    case 'CUSTOM': {
      const start = custom.from ?? custom.to!;
      const end = custom.to ?? custom.from!;
      from = localDate(start, timeZone);
      const [y, m, d] = end.split('-').map(Number) as [number, number, number];
      to = day(y, m, d + 1);
      break;
    }
    case 'THIS_MONTH':
    default:
      from = day(p.year, p.month, 1);
      to = day(p.year, p.month + 1, 1);
  }
  const length = to.getTime() - from.getTime();
  return {
    from,
    to,
    previousFrom: new Date(from.getTime() - length),
    label: preset,
  };
}

export interface SendWindow {
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  sendDays: number[];
}

/**
 * The first moment at or after `instant` inside the dealer's send window
 * (business hours on sending days, local time). Automated email waits for
 * it, so nobody receives a dealership's follow-up at 3 a.m.
 */
export function nextSendTime(instant: Date, window: SendWindow): Date {
  const days = window.sendDays.length ? window.sendDays : [0, 1, 2, 3, 4, 5, 6];
  for (let offset = 0; offset < 8; offset += 1) {
    const p = localParts(instant, window.timezone);
    const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth() + 1;
    const d = shifted.getUTCDate();
    const weekday = shifted.getUTCDay();
    if (!days.includes(weekday)) continue;
    const open = zonedTime(y, m, d, window.sendWindowStartHour, window.timezone);
    const close = zonedTime(y, m, d, window.sendWindowEndHour, window.timezone);
    if (offset === 0) {
      if (instant < open) return open;
      if (instant < close) return instant;
      continue;
    }
    return open;
  }
  return instant;
}

export function inSendWindow(instant: Date, window: SendWindow): boolean {
  return nextSendTime(instant, window).getTime() === instant.getTime();
}

export function formatLocal(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, ...options }).format(instant);
}
