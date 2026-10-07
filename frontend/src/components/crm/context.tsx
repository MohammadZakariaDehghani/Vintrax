'use client';

import { createContext, useContext } from 'react';
import type { CrmPermission } from '@vintrax/shared';
import type { CrmDealership, CrmMe } from '@/lib/crm';

export interface CrmContextValue {
  me: CrmMe;
  dealerId: string;
  dealerships: CrmDealership[];
  can: (permission: CrmPermission) => boolean;
  switchDealer: (dealerId: string) => void;
}

export const CrmContext = createContext<CrmContextValue | null>(null);

/** The caller's dealership, role, statuses, sources and staff. Only valid inside the CRM shell. */
export function useCrm(): CrmContextValue {
  const value = useContext(CrmContext);
  if (!value) throw new Error('useCrm must be used inside the CRM shell');
  return value;
}
