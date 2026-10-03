/**
 * Calendar dates for accounting. A posting date is a day, not an instant, so
 * dates travel as 'YYYY-MM-DD' strings and are stored in DATE columns; the
 * `Date` objects Prisma needs are UTC midnight of that day, which is how
 * Prisma reads and writes a DATE column.
 */

export type IsoDate = string;

export function toDbDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

/** Today in Canada's most-populous zone; a posting date never comes from UTC drift. */
export function todayIso(now: Date = new Date(), timeZone = 'America/Toronto'): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const value = toDbDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromDbDate(value);
}

/** Adds months, keeping the day (callers only use days ≤ 28, which every month has). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

export interface FiscalCalendar {
  startMonth: number;
  startDay: number;
}

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

/** The fiscal year containing `date`. */
export function fiscalYearContaining(date: IsoDate, calendar: FiscalCalendar): DateRange {
  const year = Number(date.slice(0, 4));
  const startThisYear = `${year}-${String(calendar.startMonth).padStart(2, '0')}-${String(calendar.startDay).padStart(2, '0')}`;
  const from = date >= startThisYear ? startThisYear : addMonths(startThisYear, -12);
  return { from, to: addDays(addMonths(from, 12), -1) };
}

/** A fiscal year is named for the calendar year it ends in (FY2027 ends in 2027). */
export function fiscalYearName(range: DateRange): string {
  return `FY${range.to.slice(0, 4)}`;
}

/** The twelve monthly periods of a fiscal year starting on `from`. */
export function monthlyPeriods(from: IsoDate): Array<DateRange & { number: number; name: string }> {
  return Array.from({ length: 12 }, (_, index) => {
    const start = addMonths(from, index);
    const end = addDays(addMonths(from, index + 1), -1);
    const label = new Date(`${start}T00:00:00Z`).toLocaleDateString('en-CA', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return { number: index + 1, name: `P${index + 1} · ${label}`, from: start, to: end };
  });
}

export function quarterOf(periodNumber: number): number {
  return Math.ceil(periodNumber / 3);
}
