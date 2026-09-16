'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileUp, Upload } from 'lucide-react';
import type { InventoryImportPlan, InventoryImportResult, Province } from '@vintrax/shared';
import { MAX_INVENTORY_CSV_ROWS, PROVINCES, PROVINCE_LABELS } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import {
  Button,
  Card,
  CardContent,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
} from '@/components/ui';
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
/** The fallback location as the form holds it, before it is sent. */
interface Location {
  city: string;
  province: Province | '';
}

function ImportInventory() {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<InventoryImportPlan | null>(null);
  const [result, setResult] = useState<InventoryImportResult | null>(null);
  const [city, setCity] = useState('');
  const [province, setProvince] = useState<Province | ''>('');
  const [importPhotos, setImportPhotos] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  /**
   * The location fields ride along with the file on both requests.
   *
   * Passed as an argument rather than read from state inside the mutation: a
   * re-check fired from the province dropdown runs in the render that still
   * holds the old value, so reading state there would send the previous
   * province and preview a plan the dealer did not ask for.
   *
   * They go to the preview as well as the confirm because the preview is the
   * import without the writes — if the city only reached the second call, the
   * dealer would be shown a plan that is not the plan that runs.
   */
  const asFields = (at: { city: string; province: Province | '' }) => ({
    ...(at.city.trim() ? { defaultCity: at.city.trim() } : {}),
    ...(at.province ? { defaultProvince: at.province } : {}),
  });

  const validate = useMutation({
    mutationFn: ({ chosen, at }: { chosen: File; at: Location }) =>
      api.upload<InventoryImportPlan>('/dealer/inventory/import/validate', chosen, asFields(at)),
    onSuccess: (data) => {
      setPlan(data);
      setResult(null);
    },
  });

  const confirm = useMutation({
    mutationFn: ({ chosen, fileHash, at }: { chosen: File; fileHash: string; at: Location }) =>
      api.upload<InventoryImportResult>('/dealer/inventory/import/confirm', chosen, {
        fileHash,
        ...asFields(at),
        importPhotos: String(importPhotos),
      }),
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
    if (chosen) validate.mutate({ chosen, at: { city, province } });
  }

  /**
   * Re-previews against a changed location.
   *
   * The location decides whether rows with no city of their own can be created
   * at all, so it changes the plan. The preview on screen is thrown away rather
   * than left showing counts from the previous answer.
   */
  function recheck(at: Location) {
    if (!file) return;
    setPlan(null);
    setResult(null);
    confirm.reset();
    validate.mutate({ chosen: file, at });
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

          <div className="mt-5 border-t pt-5">
            <p className="font-medium">Where are these vehicles?</p>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Most dealer management systems export one address for the whole rooftop, or none at
              all. Set a location here and it is used{' '}
              <strong>only for rows whose file gives no city or province</strong> — a row that names
              its own keeps it.
            </p>

            <div className="mt-3 grid gap-3 sm:max-w-lg sm:grid-cols-2">
              <Field label="City" htmlFor="default-city">
                <Input
                  id="default-city"
                  value={city}
                  maxLength={80}
                  placeholder="e.g. Mississauga"
                  onChange={(event) => setCity(event.target.value)}
                  onBlur={() => recheck({ city, province })}
                />
              </Field>
              <Field label="Province" htmlFor="default-province">
                <Select
                  id="default-province"
                  value={province}
                  onChange={(event) => {
                    const next = event.target.value as Province | '';
                    setProvince(next);
                    // A select has no meaningful blur step — the choice is made
                    // the moment it changes, so the file is re-checked here.
                    recheck({ city, province: next });
                  }}
                >
                  <option value="">Not set</option>
                  {PROVINCES.map((code) => (
                    <option key={code} value={code}>
                      {PROVINCE_LABELS[code]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <label className="mt-4 flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={importPhotos}
                onChange={(event) => setImportPhotos(event.target.checked)}
              />
              <span>
                <span className="font-medium">Download the photos the file points at</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Photos are copied to Vintrax and served from here, so a listing does not go blank
                  if the other system changes. Turn this off for a quick price-only import — the
                  vehicles still update, and the photos already held are left alone.
                </span>
              </span>
            </label>

            {plan && (plan.defaultLocation.city || plan.defaultLocation.province) ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Rows without a location will be listed in{' '}
                <strong>
                  {[
                    plan.defaultLocation.city,
                    plan.defaultLocation.province
                      ? PROVINCE_LABELS[plan.defaultLocation.province]
                      : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </strong>
                . Leave the fields empty to use the address on your dealership profile.
              </p>
            ) : null}
          </div>

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
            if (file) {
              confirm.mutate({ chosen: file, fileHash: plan.fileHash, at: { city, province } });
            }
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

            {/* The import is finished; the photos are not. Saying so is the
                difference between "it worked" and "why are there no pictures". */}
            {importPhotos &&
            result.rows.some((row) => row.action !== 'ERROR' && (row.photoCount ?? 0) > 0) ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Photos are downloading in the background and will appear on the listings over the
                next few minutes. You can leave this page.
              </p>
            ) : null}

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
