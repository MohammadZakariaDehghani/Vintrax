'use client';

import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { InventoryImportPlan, InventoryRowAction } from '@vintrax/shared';
import { Badge, Button, Card, CardContent } from '@/components/ui';

/**
 * What the file will do, before it does it.
 *
 * The counts are the headline, because that is the number a dealer checks
 * against what they expected — "150 updates" when they meant to change three
 * prices is the moment to stop. The table below is the detail behind it.
 */

const ACTION_VARIANT: Record<
  InventoryRowAction,
  'success' | 'default' | 'outline' | 'destructive'
> = {
  CREATE: 'success',
  UPDATE: 'default',
  UNCHANGED: 'outline',
  ERROR: 'destructive',
};

const ACTION_LABEL: Record<InventoryRowAction, string> = {
  CREATE: 'New',
  UPDATE: 'Update',
  UNCHANGED: 'No change',
  ERROR: 'Error',
};

export function ImportPreview({
  plan,
  pending,
  onConfirm,
  onCancel,
}: {
  plan: InventoryImportPlan;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Defaults to the rows that will actually change something. A 250-row file
  // whose interesting part is five errors should not make the dealer scroll.
  const [showAll, setShowAll] = useState(false);

  const { summary } = plan;
  const willWrite = summary.create + summary.update;
  const rows = showAll
    ? plan.rows
    : plan.rows.filter((row) => row.action !== 'UNCHANGED').slice(0, 100);

  return (
    <Card className="mb-5">
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Preview of {plan.filename}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing has changed yet. Confirm to apply.
            </p>
          </div>
          <Badge variant="outline">CSV schema v{plan.schemaVersion}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Total rows" value={summary.totalRows} />
          <Stat label="New vehicles" value={summary.create} tone="success" />
          <Stat label="Updates" value={summary.update} />
          <Stat label="Unchanged" value={summary.unchanged} />
          <Stat
            label="Errors"
            value={summary.errors}
            tone={summary.errors > 0 ? 'error' : undefined}
          />
        </dl>

        {plan.ignoredColumns.length > 0 ? (
          <Note>
            Ignored {plan.ignoredColumns.length === 1 ? 'column' : 'columns'}{' '}
            <strong>{plan.ignoredColumns.join(', ')}</strong>. A CSV cannot change who a vehicle
            belongs to — your account decides that.
          </Note>
        ) : null}

        {plan.unrecognisedColumns.length > 0 ? (
          <Note>
            Did not recognise <strong>{plan.unrecognisedColumns.join(', ')}</strong>. These columns
            are skipped; everything else in the file is still read. Download the template to see the
            supported column names.
          </Note>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Row</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">VIN</th>
                <th className="py-2 pr-3 font-medium">Stock #</th>
                <th className="py-2 pr-3 font-medium">Vehicle</th>
                <th className="py-2 font-medium">Changes / errors</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.row} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3 tabular">{row.row}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={ACTION_VARIANT[row.action]}>{ACTION_LABEL[row.action]}</Badge>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.vin ?? '—'}</td>
                  <td className="py-2 pr-3">{row.stockNumber ?? '—'}</td>
                  <td className="py-2 pr-3">{row.vehicle ?? '—'}</td>
                  <td className="py-2">
                    {row.errors.length > 0 ? (
                      <ul className="flex flex-col gap-1 text-destructive">
                        {row.errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    ) : row.changes.length > 0 ? (
                      <span className="text-muted-foreground">{row.changes.join(', ')}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {row.warnings.map((warning) => (
                      <p key={warning} className="mt-1 text-warning">
                        {warning}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length < plan.rows.length ? (
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAll(true)}>
            Show all {plan.rows.length} rows
          </Button>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
          <Button onClick={onConfirm} loading={pending} disabled={willWrite === 0}>
            <Check className="mr-2 h-4 w-4" aria-hidden />
            {willWrite === 0
              ? 'Nothing to import'
              : `Confirm import of ${willWrite} ${willWrite === 1 ? 'vehicle' : 'vehicles'}`}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>

          {/* Stated rather than implied. A dealer must not discover after the
              fact that five rows were dropped. */}
          {summary.errors > 0 ? (
            <p className="text-sm text-muted-foreground">
              {willWrite} {willWrite === 1 ? 'vehicle' : 'vehicles'} will be imported.{' '}
              {summary.errors} invalid {summary.errors === 1 ? 'row' : 'rows'} will be skipped and
              nothing will be written for {summary.errors === 1 ? 'it' : 'them'}.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'error';
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 text-2xl font-semibold tabular ${
          tone === 'success' ? 'text-success' : tone === 'error' ? 'text-destructive' : ''
        }`}
      >
        {value.toLocaleString('en-CA')}
      </dd>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
