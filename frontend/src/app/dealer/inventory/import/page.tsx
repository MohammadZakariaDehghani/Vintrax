'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileUp, Upload } from 'lucide-react';
import type { InventoryImportPlan, InventoryImportResult } from '@vintrax/shared';
import { MAX_INVENTORY_CSV_ROWS } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { Button, Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { DashboardNav } from '@/components/dashboard-nav';
import { ImportPreview } from './import-preview';

/**
 * Importing inventory from a spreadsheet.
 *
 * Two steps on purpose, and the first one writes nothing. A dealer uploading
 * 250 rows is making a bulk edit to their whole storefront, and the difference
 * between a good importer and a dangerous one is whether they saw what it would
 * do before it did it.
 *
 * The file is sent twice — once to preview, once to confirm — rather than being
 * parked on the server between the two. That keeps an unconfirmed upload from
 * living anywhere, and the hash returned by the preview is what guarantees the
 * second file is the one that was previewed.
 */
function ImportInventory() {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<InventoryImportPlan | null>(null);
  const [result, setResult] = useState<InventoryImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const validate = useMutation({
    mutationFn: (chosen: File) =>
      api.upload<InventoryImportPlan>('/dealer/inventory/import/validate', chosen),
    onSuccess: (data) => {
      setPlan(data);
      setResult(null);
    },
  });

  const confirm = useMutation({
    mutationFn: ({ chosen, fileHash }: { chosen: File; fileHash: string }) =>
      api.upload<InventoryImportResult>('/dealer/inventory/import/confirm', chosen, { fileHash }),
    onSuccess: (data) => {
      setResult(data);
      setPlan(null);
      void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  function choose(chosen: File | null) {
    setFile(chosen);
    setPlan(null);
    setResult(null);
    validate.reset();
    confirm.reset();
    if (chosen) validate.mutate(chosen);
  }

  function reset() {
    setFile(null);
    setPlan(null);
    setResult(null);
    validate.reset();
    confirm.reset();
    if (inputRef.current) inputRef.current.value = '';
  }

  /**
   * The template and the export both need the caller's token, so neither can be
   * a plain link — the browser would send no Authorization header and get a 401.
   */
  async function save(path: string, filename: string) {
    const blob = await api.download(path);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="container py-8">
      <DashboardNav />

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

      <div className="mb-5 flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() =>
            void save('/dealer/inventory/import/template', 'vintrax-inventory-template.csv')
          }
        >
          <Download className="mr-2 h-4 w-4" aria-hidden />
          Download template
        </Button>
        <Button
          variant="outline"
          onClick={() => void save('/dealer/inventory/export', 'vintrax-inventory.csv')}
        >
          <Download className="mr-2 h-4 w-4" aria-hidden />
          Export current inventory
        </Button>
      </div>

      <Card className="mb-5">
        <CardContent className="pt-5">
          <label className="flex flex-col items-start gap-2" htmlFor="inventory-csv">
            <span className="font-medium">Choose a CSV file</span>
            <input
              ref={inputRef}
              id="inventory-csv"
              type="file"
              accept=".csv,text/csv"
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
            <span className="text-sm text-muted-foreground">
              Export your inventory first if you want to bulk-edit what is already listed — the
              export and the import use the same columns.
            </span>
          </label>

          {file && !plan && !result && validate.isPending ? (
            <div className="mt-4">
              <Spinner label={`Checking ${file.name}`} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ErrorAlert error={validate.error ?? confirm.error} className="mb-5" />

      {plan ? (
        <ImportPreview
          plan={plan}
          pending={confirm.isPending}
          onConfirm={() => {
            if (file) confirm.mutate({ chosen: file, fileHash: plan.fileHash });
          }}
          onCancel={reset}
        />
      ) : null}

      {result ? (
        <Card>
          <CardContent className="pt-5">
            <h2 className="text-lg font-semibold">Import complete</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.summary.create} created, {result.summary.update} updated,{' '}
              {result.summary.unchanged} unchanged
              {result.summary.errors > 0 ? `, ${result.summary.errors} skipped` : ''}.
            </p>

            {result.summary.errors > 0 ? (
              <div className="mt-4">
                <p className="text-sm font-medium">
                  These rows were skipped and nothing was written for them:
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                  {result.rows
                    .filter((row) => row.action === 'ERROR')
                    .map((row) => (
                      <li key={row.row}>
                        Row {row.row}
                        {row.vin ? ` (${row.vin})` : ''}: {row.errors.join(' ')}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/dealer/inventory">
                <Button>View inventory</Button>
              </Link>
              <Button variant="ghost" onClick={reset}>
                <Upload className="mr-2 h-4 w-4" aria-hidden />
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!plan && !result && !validate.isPending ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-foreground">
              <FileUp className="h-4 w-4" aria-hidden />
              How matching works
            </h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              <li>
                A row is matched to one of your vehicles by <strong>VIN</strong> first, then by{' '}
                <strong>stock number</strong>. Matched rows update; unmatched rows create.
              </li>
              <li>
                Matching only ever looks at <strong>your own inventory</strong>. A VIN listed by
                another seller is never touched.
              </li>
              <li>
                Columns naming an owner — <code>dealer_id</code>, <code>seller_id</code> and the
                like — are ignored. Your account decides what the vehicles belong to.
              </li>
              <li>
                Re-importing the same file changes nothing the second time: rows that already match
                are reported as unchanged.
              </li>
              <li>
                <code>status</code> cannot be set to <code>ACTIVE</code>. Publishing stays a
                moderation decision, the same as it is for a single listing.
              </li>
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function ImportInventoryPage() {
  return (
    <RequireAuth>
      <ImportInventory />
    </RequireAuth>
  );
}
