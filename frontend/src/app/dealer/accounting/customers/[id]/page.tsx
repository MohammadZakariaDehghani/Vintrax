'use client';

import { useParams } from 'next/navigation';
import { PartyStatement } from '@/components/accounting/statement';

export default function CustomerStatementPage() {
  const { id } = useParams<{ id: string }>();
  return <PartyStatement kind="customers" id={id} />;
}
