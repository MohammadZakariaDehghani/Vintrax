import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccountingShell } from '@/components/accounting/shell';

export const metadata: Metadata = {
  title: 'Accounting',
  robots: { index: false, follow: false },
};

/** Dealer accounting: every page under it shares the dealership context and section nav. */
export default function AccountingLayout({ children }: { children: ReactNode }) {
  return <AccountingShell>{children}</AccountingShell>;
}
