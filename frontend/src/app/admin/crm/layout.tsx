import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SupportShell } from '@/components/crm/support-shell';

export const metadata: Metadata = {
  title: 'Admin CRM',
  robots: { index: false, follow: false },
};

export default function AdminCrmLayout({ children }: { children: ReactNode }) {
  return <SupportShell>{children}</SupportShell>;
}
