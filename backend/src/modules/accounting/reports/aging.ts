import type { AgingBucket } from '@vintrax/shared';
import { daysBetween, type IsoDate } from '../core/dates';

/** Which aging column an open item falls in, by days past its due date. */
export function agingBucket(dueDate: IsoDate, asOf: IsoDate): AgingBucket {
  const overdue = daysBetween(dueDate, asOf);
  if (overdue <= 0) return 'CURRENT';
  if (overdue <= 30) return 'D1_30';
  if (overdue <= 60) return 'D31_60';
  if (overdue <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export function emptyBuckets(): Record<AgingBucket, number> {
  return { CURRENT: 0, D1_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0 };
}
