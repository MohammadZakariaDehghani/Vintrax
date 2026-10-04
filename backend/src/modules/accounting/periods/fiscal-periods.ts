import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  fiscalYearContaining,
  fiscalYearName,
  fromDbDate,
  monthlyPeriods,
  toDbDate,
  type FiscalCalendar,
  type IsoDate,
} from '../core/dates';

/**
 * Fiscal years are created on demand: the first posting into a year creates
 * the year and its twelve monthly periods. Two concurrent first postings
 * both try; the unique (dealer, start date) constraint lets one win and the
 * other re-reads.
 */
export async function ensureFiscalYear(
  tx: Prisma.TransactionClient,
  dealerId: string,
  date: IsoDate,
  calendar: FiscalCalendar,
): Promise<{ id: string; status: 'OPEN' | 'CLOSED'; startDate: IsoDate; endDate: IsoDate }> {
  const range = fiscalYearContaining(date, calendar);
  const existing = await tx.fiscalYear.findUnique({
    where: { dealerId_startDate: { dealerId, startDate: toDbDate(range.from) } },
    select: { id: true, status: true, startDate: true, endDate: true },
  });
  if (existing) {
    return {
      id: existing.id,
      status: existing.status,
      startDate: fromDbDate(existing.startDate),
      endDate: fromDbDate(existing.endDate),
    };
  }

  // An existing year that overlaps (the fiscal calendar changed) blocks this.
  const overlapping = await tx.fiscalYear.findFirst({
    where: {
      dealerId,
      startDate: { lte: toDbDate(range.to) },
      endDate: { gte: toDbDate(range.from) },
    },
    select: { name: true },
  });
  if (overlapping) {
    throw new ConflictException(
      `${date} falls inside ${overlapping.name}, which does not match the current fiscal calendar`,
    );
  }

  const year = await tx.fiscalYear.create({
    data: {
      dealerId,
      name: fiscalYearName(range),
      startDate: toDbDate(range.from),
      endDate: toDbDate(range.to),
      periods: {
        create: monthlyPeriods(range.from).map((period) => ({
          dealerId,
          number: period.number,
          name: period.name,
          startDate: toDbDate(period.from),
          endDate: toDbDate(period.to),
        })),
      },
    },
    select: { id: true, status: true },
  });
  return { id: year.id, status: year.status, startDate: range.from, endDate: range.to };
}

/** Refuses a date in a closed period, with a message that says what to do. */
export async function assertPeriodOpen(
  tx: Prisma.TransactionClient,
  dealerId: string,
  date: IsoDate,
  calendar: FiscalCalendar,
): Promise<void> {
  await ensureFiscalYear(tx, dealerId, date, calendar);
  const period = await tx.accountingPeriod.findFirst({
    where: { dealerId, startDate: { lte: toDbDate(date) }, endDate: { gte: toDbDate(date) } },
    select: { status: true, name: true },
  });
  if (period?.status === 'CLOSED') {
    throw new ConflictException({
      message: `The period ${period.name} is closed. Post an adjusting entry in an open period, or reopen it.`,
      code: 'PERIOD_CLOSED',
    });
  }
}

export async function fiscalCalendarOf(
  tx: Prisma.TransactionClient,
  dealerId: string,
): Promise<FiscalCalendar> {
  const settings = await tx.accountingSettings.findUniqueOrThrow({
    where: { dealerId },
    select: { fiscalYearStartMonth: true, fiscalYearStartDay: true },
  });
  return { startMonth: settings.fiscalYearStartMonth, startDay: settings.fiscalYearStartDay };
}
