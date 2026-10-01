'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MAX_INVENTORY_CSV_ROWS } from '@vintrax/shared';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { DealerNav } from '@/components/dealer-nav';
import { InventoryImportFlow } from './import-flow';

function ImportInventory() {
  return (
    <div className="container py-8">
      <DashboardNav />
      <DealerNav />

      <Link
        href="/dealer/inventory"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to inventory
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Import inventory</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Upload a CSV to add and update vehicles in bulk. Nothing changes until you confirm — the
          first step only reports what the file would do. Up to{' '}
          {MAX_INVENTORY_CSV_ROWS.toLocaleString('en-CA')} rows per file.
        </p>
      </div>

      <InventoryImportFlow />
    </div>
  );
}

export default function ImportInventoryPage() {
  return (
    <RequireAuth sellersOnly dealersOnly>
      <ImportInventory />
    </RequireAuth>
  );
}
