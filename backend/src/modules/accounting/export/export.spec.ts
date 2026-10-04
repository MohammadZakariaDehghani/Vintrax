import { inflateRawSync } from 'node:zlib';
import { toPdfFile } from './pdf';
import { centsDisplay, centsText, toCsvFile, type ReportTable } from './table';
import { toXlsxFile } from './xlsx';
import { crc32, zip } from './zip';

const table: ReportTable = {
  title: 'Trial balance',
  subtitle: 'Garage Élan · 2026-01-01 to 2026-03-31',
  columns: [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Account' },
    { key: 'debit', label: 'Debit', kind: 'money' },
    { key: 'credit', label: 'Credit', kind: 'money' },
    { key: 'margin', label: 'Margin', kind: 'percent' },
  ],
  rows: [
    { code: '1000', name: 'Cash on hand', debit: 123_456, credit: null, margin: 1964 },
    { code: '2000', name: '=HYPERLINK("http://evil")', debit: null, credit: -5, margin: null },
    { code: '3000', name: 'Owner (equity) \\ test', debit: 0, credit: 123_451, margin: 0 },
  ],
  totals: { name: 'Totals', debit: 123_456, credit: 123_446 },
};

/** Reads the entries back out of a ZIP, checking each CRC. */
function unzip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const crc = buffer.readUInt32LE(offset + 14);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const data = inflateRawSync(buffer.subarray(start, start + size));
    expect(crc32(data)).toBe(crc);
    files.set(name, data.toString('utf8'));
    offset = start + size;
  }
  expect(buffer.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}

describe('report exports', () => {
  it('formats cents exactly, without floating point', () => {
    expect(centsText(123_456)).toBe('1234.56');
    expect(centsText(-5)).toBe('-0.05');
    expect(centsText(0)).toBe('0.00');
    expect(centsText(900_719_925_474_099)).toBe('9007199254740.99');
    expect(centsDisplay(-123_456)).toBe('($1,234.56)');
  });

  it('writes CSV with plain amounts and neutralises formula injection', () => {
    const csv = toCsvFile(table).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Trial balance');
    expect(lines[1]).toContain('Élan');
    expect(lines[3]).toBe('Code,Account,Debit,Credit,Margin');
    expect(lines[4]).toBe('1000,Cash on hand,1234.56,,19.64%');
    // The formula is made literal; the negative amount stays a number.
    expect(lines[5]).toMatch(/^2000,"?'=HYPERLINK/);
    expect(lines[5]).toContain(',-0.05,');
    expect(lines[7]).toBe(',Totals,1234.56,1234.46,');
  });

  it('builds a valid xlsx package with numeric amounts', () => {
    const files = unzip(toXlsxFile(table));
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<v>1234.56</v>');
    expect(sheet).toContain('<v>-0.05</v>');
    // Text is escaped, never interpreted.
    expect(sheet).toContain('=HYPERLINK(&quot;http://evil&quot;)');
    expect(sheet).not.toContain('<f>');
    expect(files.get('xl/workbook.xml')).toContain('name="Trial balance"');
  });

  it('round-trips arbitrary data through the zip writer', () => {
    const data = Buffer.from('x'.repeat(10_000) + 'é');
    const files = unzip(
      zip([
        { name: 'a.txt', data },
        { name: 'b/c.txt', data: Buffer.from('') },
      ]),
    );
    expect(files.get('a.txt')).toBe(data.toString('utf8'));
    expect(files.get('b/c.txt')).toBe('');
  });

  it('writes a well-formed PDF with an xref table and escaped text', () => {
    const pdf = toPdfFile(table, new Date('2026-04-01T12:00:00Z'));
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // startxref points at the xref table.
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    // Every object offset in the table is right.
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) =>
      Number(match[1]),
    );
    offsets.forEach((offset, index) =>
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true),
    );
    expect(text).toContain('($1,234.56)');
    expect(text).toContain('(Owner \\(equity\\) \\\\ test)');
    expect(text).toContain('page 1 of 1');
  });

  it('paginates long reports', () => {
    const long: ReportTable = {
      ...table,
      rows: Array.from({ length: 200 }, (_, i) => ({
        code: String(i),
        name: `Account ${i}`,
        debit: i,
      })),
    };
    const text = toPdfFile(long).toString('latin1');
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(3);
    expect(text).toContain(`page ${pages} of ${pages}`);
  });
});
