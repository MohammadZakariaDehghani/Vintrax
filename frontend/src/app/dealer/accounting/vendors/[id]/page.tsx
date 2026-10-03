'use client';

import { useParams } from 'next/navigation';
import { PartyStatement } from '@/components/accounting/statement';

export default function VendorStatementPage() {
  const { id } = useParams<{ id: string }>();
  return <PartyStatement kind="vendors" id={id} />;
}
