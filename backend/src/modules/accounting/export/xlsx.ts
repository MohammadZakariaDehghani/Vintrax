import type { ReportTable } from './table';
import { centsText } from './table';
import { zip } from './zip';

/**
 * An Excel workbook (.xlsx, Office Open XML) with one sheet: a title, the
 * column headings, the rows and a totals row. Amounts are real numbers in an
 * accounting format, so the dealer can sum and filter them.
 */
export function toXlsxFile(table: ReportTable): Buffer {
  const xml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Control characters are not allowed in XML 1.0.
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
      })
      .join('');

  const columnName = (index: number) => {
    let name = '';
    let n = index + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  };

  // Styles: 0 default, 1 bold, 2 money, 3 bold money, 4 percent.
  const textCell = (ref: string, value: string, style = 0) =>
    `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  const numberCell = (ref: string, value: string, style = 0) =>
    `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;

  const rows: string[] = [];
  let r = 1;
  rows.push(`<row r="${r}">${textCell(`A${r}`, table.title, 1)}</row>`);
  r += 1;
  if (table.subtitle) {
    rows.push(`<row r="${r}">${textCell(`A${r}`, table.subtitle)}</row>`);
    r += 1;
  }
  r += 1;
  rows.push(
    `<row r="${r}">${table.columns.map((column, index) => textCell(`${columnName(index)}${r}`, column.label, 1)).join('')}</row>`,
  );
  const header = r;
  r += 1;

  const writeRow = (row: Record<string, string | number | null | undefined>, bold: boolean) => {
    const cells = table.columns.map((column, index) => {
      const ref = `${columnName(index)}${r}`;
      const value = row[column.key];
      if (value === null || value === undefined || value === '') return '';
      if (typeof value === 'number') {
        if (column.kind === 'money') return numberCell(ref, centsText(value), bold ? 3 : 2);
        if (column.kind === 'percent') return numberCell(ref, String(value / 10_000), 4);
        return numberCell(ref, String(value), bold ? 1 : 0);
      }
      return textCell(ref, String(value), bold ? 1 : 0);
    });
    rows.push(`<row r="${r}">${cells.join('')}</row>`);
    r += 1;
  };
  for (const row of table.rows) writeRow(row, false);
  if (table.totals) writeRow(table.totals, true);

  const widths = table.columns
    .map((column, index) => {
      const longest = Math.max(
        column.label.length,
        ...table.rows.slice(0, 200).map((row) => String(row[column.key] ?? '').length),
      );
      const width = column.kind === 'money' ? 16 : Math.min(60, Math.max(10, longest + 2));
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header}" topLeftCell="A${header + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;(#,##0.00)"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="5">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
    `<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs></styleSheet>`;

  const sheetName = xml(table.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/styles.xml', data: styles },
  ];
  return zip(files.map((file) => ({ name: file.name, data: Buffer.from(file.data, 'utf8') })));
}
