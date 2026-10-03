import { escapeCsvCell } from '@vintrax/shared';

/** A report flattened for export: the same shape feeds CSV, Excel and PDF. */
export interface ReportTable {
  title: string;
  subtitle?: string;
  columns: Array<{ key: string; label: string; kind?: 'text' | 'money' | 'number' | 'percent' }>;
  rows: Array<Record<string, string | number | null | undefined>>;
  /** A final, emphasised row (totals). */
  totals?: Record<string, string | number | null | undefined>;
}

/** Cents → "1234.56" / "-1234.56": exact, unformatted, for files people compute with. */
export function centsText(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Cents → "$1,234.56", negatives in parentheses, for reading. */
export function centsDisplay(cents: number): string {
  const abs = Math.abs(cents);
  const text = `$${Math.floor(abs / 100).toLocaleString('en-CA')}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `(${text})` : text;
}

export function cellText(value: string | number | null | undefined, kind: string | undefined, forDisplay: boolean): string {
  if (value === null || value === undefined) return '';
  if (kind === 'money' && typeof value === 'number') return forDisplay ? centsDisplay(value) : centsText(value);
  if (kind === 'percent' && typeof value === 'number') return `${(value / 100).toFixed(2)}%`;
  return String(value);
}

/**
 * CSV. Text cells are neutralised against spreadsheet formula injection
 * (a leading = + - @ becomes literal); amounts are written as plain numbers
 * so a negative balance stays a number in Excel.
 */
export function toCsvFile(table: ReportTable): Buffer {
  const lines: string[] = [];
  lines.push(escapeCsvCell(table.title));
  if (table.subtitle) lines.push(escapeCsvCell(table.subtitle));
  lines.push('');
  lines.push(table.columns.map((column) => escapeCsvCell(column.label)).join(','));
  const write = (row: Record<string, string | number | null | undefined>) =>
    table.columns
      .map((column) => {
        const value = row[column.key];
        if (typeof value === 'number' && (column.kind === 'money' || column.kind === 'number' || column.kind === 'percent')) {
          return cellText(value, column.kind, false);
        }
        return escapeCsvCell(value === null || value === undefined ? '' : String(value));
      })
      .join(',');
  for (const row of table.rows) lines.push(write(row));
  if (table.totals) lines.push(write(table.totals));
  // A BOM so Excel reads the file as UTF-8 (accents in names survive).
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}
