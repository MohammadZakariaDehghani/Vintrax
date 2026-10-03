import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DATE_RANGE_PRESET_LABELS, type DateRangePreset } from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  addDays,
  addMonths,
  daysBetween,
  fiscalYearContaining,
  todayIso,
  type DateRange,
  type FiscalCalendar,
  type IsoDate,
} from '../core/dates';

export interface ResolvedRange extends DateRange {
  preset: DateRangePreset;
  label: string;
}

/**
 * Turns a preset (or a custom from/to) into dates, using the dealer's own
 * fiscal calendar for the fiscal presets — never an assumed January start.
 * "Quarter" and "Year to date" are fiscal too.
 */
export function rangeFor(
  preset: DateRangePreset,
  calendar: FiscalCalendar,
  today: IsoDate,
  custom?: { from?: IsoDate; to?: IsoDate },
): ResolvedRange {
  const fiscal = fiscalYearContaining(today, calendar);
  let range: DateRange;
  switch (preset) {
    case 'TODAY':
      range = { from: today, to: today };
      break;
    case 'THIS_WEEK': {
      const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
      const from = addDays(today, -weekday);
      range = { from, to: addDays(from, 6) };
      break;
    }
    case 'THIS_MONTH': {
      const from = `${today.slice(0, 7)}-01`;
      range = { from, to: addDays(addMonths(from, 1), -1) };
      break;
    }
    case 'LAST_MONTH': {
      const from = addMonths(`${today.slice(0, 7)}-01`, -1);
      range = { from, to: addDays(addMonths(from, 1), -1) };
      break;
    }
    case 'THIS_QUARTER': {
      const monthsIn = Math.floor(
        (Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - (Number(fiscal.from.slice(0, 4)) * 12 + Number(fiscal.from.slice(5, 7)))) /
          3,
      );
      let from = addMonths(fiscal.from, monthsIn * 3);
      if (from > today) from = addMonths(from, -3);
      range = { from, to: addDays(addMonths(from, 3), -1) };
      break;
    }
    case 'YEAR_TO_DATE':
      range = { from: fiscal.from, to: today };
      break;
    case 'CURRENT_FISCAL_YEAR':
      range = fiscal;
      break;
    case 'PREVIOUS_FISCAL_YEAR':
      range = { from: addMonths(fiscal.from, -12), to: addDays(fiscal.from, -1) };
      break;
    case 'CUSTOM': {
      if (!custom?.from || !custom.to) throw new BadRequestException('Choose a start and an end date');
      if (custom.to < custom.from) throw new BadRequestException('The end date is before the start date');
      if (daysBetween(custom.from, custom.to) > 3700) throw new BadRequestException('Choose ten years or less');
      range = { from: custom.from, to: custom.to };
      break;
    }
  }
  return { ...range, preset, label: DATE_RANGE_PRESET_LABELS[preset] };
}

/** The period before, of the same length, or the same period a year earlier. */
export function comparisonRange(range: DateRange, mode: 'PREVIOUS_PERIOD' | 'PREVIOUS_YEAR'): DateRange {
  if (mode === 'PREVIOUS_YEAR') return { from: addMonths(range.from, -12), to: addMonths(range.to, -12) };
  // A whole-month range compares with the months before it; anything else by days.
  const wholeMonths =
    range.from.endsWith('-01') && addDays(range.to, 1).endsWith('-01');
  if (wholeMonths) {
    const months =
      Number(addDays(range.to, 1).slice(0, 4)) * 12 + Number(addDays(range.to, 1).slice(5, 7)) -
      (Number(range.from.slice(0, 4)) * 12 + Number(range.from.slice(5, 7)));
    return { from: addMonths(range.from, -months), to: addDays(range.from, -1) };
  }
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

export async function fiscalCalendar(
  db: Prisma.TransactionClient | PrismaService,
  dealerId: string,
): Promise<FiscalCalendar> {
  const settings = await db.accountingSettings.findUniqueOrThrow({
    where: { dealerId },
    select: { fiscalYearStartMonth: true, fiscalYearStartDay: true },
  });
  return { startMonth: settings.fiscalYearStartMonth, startDay: settings.fiscalYearStartDay };
}

export async function resolveRange(
  db: Prisma.TransactionClient | PrismaService,
  dealerId: string,
  query: { preset?: DateRangePreset; from?: IsoDate; to?: IsoDate },
  fallback: DateRangePreset = 'CURRENT_FISCAL_YEAR',
): Promise<ResolvedRange> {
  const calendar = await fiscalCalendar(db, dealerId);
  const preset = query.preset ?? (query.from && query.to ? 'CUSTOM' : fallback);
  return rangeFor(preset, calendar, todayIso(), { from: query.from, to: query.to });
}
