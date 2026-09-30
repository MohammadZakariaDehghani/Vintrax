import type { FinanceApplicationStatus } from '@vintrax/shared';

/** The badge colour for each status, shared by the list and the detail page. */
export const FINANCE_STATUS_VARIANT: Record<
  FinanceApplicationStatus,
  'primary' | 'accent' | 'warning' | 'success' | 'destructive' | 'default'
> = {
  NEW: 'primary',
  CONTACTED: 'accent',
  IN_REVIEW: 'warning',
  APPROVED: 'success',
  DECLINED: 'destructive',
  CLOSED: 'default',
};
