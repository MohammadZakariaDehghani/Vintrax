import { cellText, type ReportTable } from './table';

/**
 * A plain PDF (1.4) of a report table, with the standard Helvetica fonts —
 * landscape Letter pages, a repeated header row, right-aligned amounts and
 * page numbers. No dependency: PDF text output is simple enough to write.
 *
 * Text is encoded as WinAnsi (Latin-1), which covers English and French;
 * anything outside it is replaced rather than corrupting the file.
 */

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 36;
const FONT_SIZE = 8;
const ROW_HEIGHT = 12;

/** Approximate Helvetica advance widths (per 1000 em) — enough to fit columns. */
function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const char of text) {
    if ('ijl.,:;|!\''.includes(char)) units += 278;
    else if ('ftrI()[]- '.includes(char)) units += 333;
    else if ('mwMW'.includes(char)) units += 833;
    else if (/[A-Z]/.test(char)) units += 667;
    else if (/[0-9$]/.test(char)) units += 556;
    else units += 520;
  }
  return (units * size * (bold ? 1.05 : 1)) / 1000;
}

/** Common punctuation outside Latin-1 that WinAnsi has a slot for. */
const WIN_ANSI: Record<number, number> = {
  0x2026: 0x85, // …
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95, // •
  0x2212: 0x2d, // minus sign
  0x20ac: 0x80, // €
};

function pdfString(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const byte = WIN_ANSI[code] ?? code;
    if (byte > 0xff || byte < 0x20) {
      out += '?';
    } else if (char === '(' || char === ')' || char === '\\') {
      out += `\\${char}`;
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return `(${out})`;
}

function fit(text: string, width: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= width) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, size, bold) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export function toPdfFile(table: ReportTable, generatedAt = new Date()): Buffer {
  const usable = PAGE_WIDTH - MARGIN * 2;
  // Column widths: amounts get a fixed share, text columns split the rest by content.
  const natural = table.columns.map((column) => {
    if (column.kind === 'money') return 72;
    if (column.kind === 'number' || column.kind === 'percent') return 48;
    const longest = Math.max(
      textWidth(column.label, FONT_SIZE, true),
      ...table.rows.slice(0, 300).map((row) => textWidth(cellText(row[column.key], column.kind, true), FONT_SIZE)),
    );
    return Math.min(220, Math.max(40, longest + 6));
  });
  const scale = Math.min(1, usable / natural.reduce((sum, width) => sum + width, 0));
  const widths = natural.map((width) => width * scale);

  const pages: string[] = [];
  let ops: string[] = [];
  let y = 0;

  const text = (x: number, yy: number, value: string, bold = false, size = FONT_SIZE) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td ${pdfString(value)} Tj ET`);

  const drawRow = (row: Record<string, string | number | null | undefined>, bold: boolean, header = false) => {
    let x = MARGIN;
    table.columns.forEach((column, index) => {
      const width = widths[index]!;
      const value = header ? column.label : cellText(row[column.key], column.kind, true);
      const shown = fit(value, width - 4, FONT_SIZE, bold);
      const right = !header && (column.kind === 'money' || column.kind === 'number' || column.kind === 'percent');
      const offset = right ? width - 2 - textWidth(shown, FONT_SIZE, bold) : 2;
      text(x + offset, y, shown, bold);
      x += width;
    });
    y -= ROW_HEIGHT;
  };

  const startPage = () => {
    if (ops.length) pages.push(ops.join('\n'));
    ops = [];
    y = PAGE_HEIGHT - MARGIN;
    text(MARGIN, y, table.title, true, 13);
    y -= 16;
    if (table.subtitle) {
      text(MARGIN, y, table.subtitle, false, 9);
      y -= 14;
    }
    y -= 6;
    drawRow({}, true, true);
    ops.push(`${MARGIN} ${(y + ROW_HEIGHT - 3).toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${(y + ROW_HEIGHT - 3).toFixed(2)} l 0.5 w S`);
  };

  startPage();
  const rows: Array<[Record<string, string | number | null | undefined>, boolean]> = table.rows.map((row) => [row, false]);
  if (table.totals) rows.push([table.totals, true]);
  for (const [row, bold] of rows) {
    if (y < MARGIN + ROW_HEIGHT * 2) startPage();
    if (bold) ops.push(`${MARGIN} ${(y + ROW_HEIGHT - 3).toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${(y + ROW_HEIGHT - 3).toFixed(2)} l 0.5 w S`);
    drawRow(row, bold);
  }
  pages.push(ops.join('\n'));

  // Footers need the page count.
  const stamp = generatedAt.toISOString().slice(0, 16).replace('T', ' ');
  const footed = pages.map((content, index) => {
    const footer = `Vintrax accounting · generated ${stamp} UTC · page ${index + 1} of ${pages.length}`;
    return `${content}\nBT /F1 7 Tf ${MARGIN} 20 Td ${pdfString(footer)} Tj ET`;
  });

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, then a content + page pair per page.
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = footed.map((_, index) => `${6 + index * 2} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${footed.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  footed.forEach((content, index) => {
    const contentId = 5 + index * 2;
    const pageId = 6 + index * 2;
    const stream = Buffer.from(content, 'latin1');
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${content}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  });

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = offset;
    const chunk = Buffer.from(`${id} 0 obj\n${objects[id]}\nendobj\n`, 'latin1');
    chunks.push(chunk);
    offset += chunk.length;
  }
  const xref = [`xref\n0 ${objects.length}\n`, '0000000000 65535 f \n'];
  for (let id = 1; id < objects.length; id += 1) xref.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  chunks.push(
    Buffer.from(
      `${xref.join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(chunks);
}
