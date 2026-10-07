'use client';

import { useState } from 'react';
import { CONSENT_TYPES, CONSENT_TYPE_LABELS, LEAD_IMPORT_FIELDS, type ConsentType, type LeadImportField } from '@vintrax/shared';
import { Button, Card, CardContent, ErrorAlert, Field, Input, Select } from '@/components/ui';
import { useCrm } from '@/components/crm/context';
import { DataTable, PageHeader, Section, StatusPill, useCrmMutation, useCrmQuery } from '@/components/crm/ui';
import { crm, dateTime } from '@/lib/crm';

const FIELD_LABELS: Record<LeadImportField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  city: 'City',
  province: 'Province',
  postalCode: 'Postal code',
  source: 'Source',
  campaign: 'Campaign',
  vin: 'VIN',
  budget: 'Budget',
  notes: 'Notes',
  tags: 'Tags (; separated)',
  status: 'Status',
};

/** Guesses a field from a header: "E-mail Address" → email. */
function guess(header: string): LeadImportField | '' {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  if (/^(first|firstname|given)/.test(h)) return 'firstName';
  if (/^(last|lastname|surname|family)/.test(h)) return 'lastName';
  if (h === 'name' || h === 'fullname' || h === 'customer') return 'fullName';
  if (h.includes('email')) return 'email';
  if (h.includes('phone') || h.includes('mobile') || h.includes('cell')) return 'phone';
  if (h === 'city') return 'city';
  if (h.includes('province') || h === 'state') return 'province';
  if (h.includes('postal') || h.includes('zip')) return 'postalCode';
  if (h.includes('source')) return 'source';
  if (h.includes('campaign')) return 'campaign';
  if (h.includes('vin')) return 'vin';
  if (h.includes('budget')) return 'budget';
  if (h.includes('note') || h.includes('comment')) return 'notes';
  if (h.includes('tag')) return 'tags';
  if (h.includes('status')) return 'status';
  return '';
}

/** Headers of the first line, honouring quotes. */
function headersOf(csv: string): string[] {
  const line = csv.split(/\r?\n/)[0] ?? '';
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells.filter(Boolean);
}

interface Preview {
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: Array<{ row: number; status: string; name: string; email: string | null; phone: string | null; errors: string[] }>;
}

interface ImportRecord {
  id: string;
  fileName: string;
  totalRows: number;
  createdCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: Array<{ row: number; errors: string[] }> | null;
  createdAt: string;
}

export default function ImportLeadsPage() {
  const { me } = useCrm();
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [mapping, setMapping] = useState<Record<string, LeadImportField | ''>>({});
  const [duplicates, setDuplicates] = useState<'SKIP' | 'CREATE'>('SKIP');
  const [defaultSourceId, setDefaultSourceId] = useState('');
  const [consent, setConsent] = useState<{ type: ConsentType | ''; source: string }>({ type: '', source: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<ImportRecord | null>(null);
  const history = useCrmQuery<ImportRecord[]>(['imports'], '/leads/imports');

  const body = () => ({
    fileName,
    csv,
    mapping: Object.fromEntries(Object.entries(mapping).filter(([, field]) => field)),
    duplicates,
    defaultSourceId: defaultSourceId || null,
    consent: consent.type ? { type: consent.type, source: consent.source || `Imported from ${fileName}`, evidence: null } : null,
  });
  const check = useCrmMutation(() => crm.post<Preview>('/leads/import/preview', body()), (result) => setPreview(result), 'crm-preview');
  const run = useCrmMutation(() => crm.post<ImportRecord>('/leads/import', body()), (result) => {
    setDone(result);
    setPreview(null);
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setPreview(null);
    setDone(null);
    setMapping(Object.fromEntries(headersOf(text).map((header) => [header, guess(header)])));
  };

  return (
    <>
      <PageHeader title="Import leads" description="Upload a CSV, map its columns, check the preview, then import. Rows that match an existing lead by email or phone are flagged as duplicates." />
      <Card className="mb-6">
        <CardContent className="space-y-4 pt-5">
          <Field label="CSV file" htmlFor="csv-file" hint="Up to 2,000 rows. The first line must be column headers.">
            <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event.target.files?.[0])} />
          </Field>
          {Object.keys(mapping).length ? (
            <>
              <h2 className="text-sm font-semibold">Map columns</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.keys(mapping).map((header) => (
                  <Field key={header} label={header} htmlFor={`map-${header}`}>
                    <Select id={`map-${header}`} value={mapping[header]} onChange={(event) => setMapping({ ...mapping, [header]: event.target.value as LeadImportField | '' })}>
                      <option value="">Ignore</option>
                      {LEAD_IMPORT_FIELDS.map((field) => (
                        <option key={field} value={field}>{FIELD_LABELS[field]}</option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Rows matching an existing lead" htmlFor="dupes">
                  <Select id="dupes" value={duplicates} onChange={(event) => setDuplicates(event.target.value as 'SKIP' | 'CREATE')}>
                    <option value="SKIP">Skip them</option>
                    <option value="CREATE">Import them anyway</option>
                  </Select>
                </Field>
                <Field label="Source for rows without one" htmlFor="default-source">
                  <Select id="default-source" value={defaultSourceId} onChange={(event) => setDefaultSourceId(event.target.value)}>
                    <option value="">Import/API</option>
                    {me.sources.map((source) => (
                      <option key={source.id} value={source.id}>{source.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Marketing consent" htmlFor="import-consent" hint="Only if every person on the list gave it. A purchased or scraped list is not consent.">
                  <Select id="import-consent" value={consent.type} onChange={(event) => setConsent({ ...consent, type: event.target.value as ConsentType | '' })}>
                    <option value="">None (transactional email only)</option>
                    {CONSENT_TYPES.map((type) => (
                      <option key={type} value={type}>{CONSENT_TYPE_LABELS[type]}</option>
                    ))}
                  </Select>
                </Field>
                {consent.type ? (
                  <Field label="Where the consent was given" htmlFor="import-consent-source" className="sm:col-span-3">
                    <Input id="import-consent-source" value={consent.source} onChange={(event) => setConsent({ ...consent, source: event.target.value })} />
                  </Field>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" loading={check.isPending} onClick={() => check.mutate(undefined)}>Check the file</Button>
                <Button disabled={!preview} loading={run.isPending} onClick={() => run.mutate(undefined)}>
                  Import {preview ? `${duplicates === 'SKIP' ? preview.newCount : preview.newCount + preview.duplicateCount} lead(s)` : ''}
                </Button>
              </div>
            </>
          ) : null}
          <ErrorAlert error={check.error ?? run.error} />
        </CardContent>
      </Card>

      {done ? (
        <Card className="mb-6 border-success">
          <CardContent className="pt-5 text-sm">
            Imported {done.createdCount} of {done.totalRows} rows · {done.duplicateCount} duplicate(s) · {done.errorCount} error(s).
          </CardContent>
        </Card>
      ) : null}

      {preview ? (
        <Section title="Preview" description={`${preview.totalRows} rows: ${preview.newCount} new, ${preview.duplicateCount} duplicates, ${preview.errorCount} with errors. The first 200 are shown.`}>
          <DataTable
            dense
            rows={preview.rows}
            rowKey={(row) => String(row.row)}
            columns={[
              { key: 'row', label: 'Row', render: (row) => row.row },
              { key: 'status', label: 'Result', render: (row) => <StatusPill status={row.status === 'NEW' ? 'ACTIVE' : row.status === 'DUPLICATE' ? 'WAITING' : 'FAILED'} /> },
              { key: 'name', label: 'Name', render: (row) => row.name || '—' },
              { key: 'contact', label: 'Email / phone', render: (row) => [row.email, row.phone].filter(Boolean).join(' · ') || '—' },
              { key: 'errors', label: 'Notes', render: (row) => <span className="text-xs">{row.errors.join('; ')}</span> },
            ]}
          />
        </Section>
      ) : null}

      <Section title="Import history">
        <DataTable
          rows={history.data}
          loading={history.isPending}
          error={history.error}
          rowKey={(row) => row.id}
          columns={[
            { key: 'when', label: 'When', render: (row) => dateTime(row.createdAt) },
            { key: 'file', label: 'File', render: (row) => row.fileName },
            { key: 'rows', label: 'Rows', align: 'right', render: (row) => row.totalRows },
            { key: 'created', label: 'Imported', align: 'right', render: (row) => row.createdCount },
            { key: 'dupes', label: 'Duplicates', align: 'right', render: (row) => row.duplicateCount },
            {
              key: 'errors',
              label: 'Errors',
              render: (row) =>
                row.errorCount ? (
                  <details>
                    <summary className="cursor-pointer text-destructive">{row.errorCount}</summary>
                    <ul className="mt-1 text-xs">
                      {(row.errors ?? []).slice(0, 50).map((entry) => (
                        <li key={entry.row}>Row {entry.row}: {entry.errors.join('; ')}</li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  '0'
                ),
            },
          ]}
        />
      </Section>
    </>
  );
}
