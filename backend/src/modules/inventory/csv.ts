/**
 * CSV reading and writing, to RFC 4180.
 *
 * Hand-written rather than a dependency. The whole surface is two functions and
 * the behaviours that actually matter here — quoted fields containing commas
 * and newlines, doubled quotes, CRLF, a UTF-8 BOM — are a page of code and a
 * page of tests. A parser dependency would be a larger audit surface than the
 * thing it replaces, on the one input path in this application that accepts a
 * file from outside and writes to many rows at once.
 */

/** Thrown for a file that is not CSV at all, as opposed to CSV with bad data. */
export class CsvParseError extends Error {}

/**
 * Splits CSV text into rows of raw cells.
 *
 * Nothing is trimmed, coerced or interpreted here: this turns bytes into a
 * grid, and meaning is applied later, where it can be reported per row.
 */
export function parseCsv(input: string): string[][] {
  // A BOM is invisible in a spreadsheet and would otherwise become part of the
  // first header, so the first column silently fails to map.
  const text = input.replace(/^\uFEFF/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0 || fieldWasQuoted) {
        // A quote after other characters is data, not a delimiter. Excel emits
        // this for values like 6" lift, and rejecting the file over it would be
        // pedantry that costs the dealer their import.
        field += char;
      } else {
        inQuotes = true;
        fieldWasQuoted = true;
      }
      continue;
    }

    if (char === ',') {
      endField();
      continue;
    }

    if (char === '\r') {
      // CRLF and a bare CR both end the row; the LF is consumed with it.
      if (text[i + 1] === '\n') i += 1;
      endRow();
      continue;
    }

    if (char === '\n') {
      endRow();
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new CsvParseError(
      'The file ends inside a quoted value. A quotation mark is probably unclosed.',
    );
  }

  // A trailing newline should not produce a final empty row, but a genuine
  // blank line in the middle of the file should survive as one, so that row
  // numbers in error messages match what the dealer sees in their spreadsheet.
  if (field.length > 0 || fieldWasQuoted || row.length > 0) endRow();

  return rows;
}

/** True for a row a spreadsheet produced by leaving a line blank. */
export function isBlankRow(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim().length === 0);
}

/**
 * Quotes one value for output.
 *
 * The leading apostrophe is not cosmetic. A cell beginning `=`, `+`, `-`, `@`
 * or a control character is executed as a formula when the file is opened in
 * Excel, Sheets or LibreOffice, which turns an exported listing description
 * into code running on the dealer's machine. Prefixing neutralises it, and the
 * apostrophe is not displayed as content by those applications.
 *
 * This is applied on export only. On import the same text is data, and stripping
 * it there would corrupt a legitimate value.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Joins rows into a CSV document, CRLF-terminated as RFC 4180 specifies. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}
