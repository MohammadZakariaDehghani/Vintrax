'use client';

import { createContext, useContext } from 'react';
import type { AccountingPermission } from '@vintrax/shared';
import type { AccountingStatus, Dealership } from '@/lib/accounting';

export interface AccountingContextValue {
  status: AccountingStatus;
  dealerId: string;
  dealerships: Dealership[];
  can: (permission: AccountingPermission) => boolean;
  switchDealer: (dealerId: string) => void;
}

export const AccountingContext = createContext<AccountingContextValue | null>(null);

/** The caller's dealership and role. Only valid inside the accounting shell. */
export function useAccounting(): AccountingContextValue {
  const value = useContext(AccountingContext);
  if (!value) throw new Error('useAccounting must be used inside the accounting shell');
  return value;
}
