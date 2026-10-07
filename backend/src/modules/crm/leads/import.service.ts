import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PROVINCES,
  leadSchema,
  normalizeEmail,
  normalizePhone,
  type LeadImportField,
  type LeadImportInput,
  type LeadInput,
} from '@vintrax/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CsvParseError, isBlankRow, parseCsv } from '../../inventory/csv';
import { crmAudit } from '../core/audit';
import { assertCrm, type CrmContext } from '../core/context';
import { LeadsService } from './leads.service';

const MAX_ROWS = 2_000;

interface RowResult {
  row: number;
  status: 'NEW' | 'DUPLICATE' | 'ERROR';
  name: string;
  email: string | null;
  phone: string | null;
  errors: string[];
  duplicateOf?: { id: string; number: number } | null;
  input?: LeadInput;
}

/**
 * CSV lead import: map columns, validate every row with the same schema as
 * the lead form, flag duplicates (against existing leads and within the
 * file), preview, then import. Each run is kept in the import history with
 * its error report.
 */
@Injectable()
export class LeadImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  async preview(ctx: CrmContext, input: LeadImportInput) {
    assertCrm(ctx, 'crm.manage');
    const rows = await this.evaluate(ctx, input);
    return {
      totalRows: rows.length,
      newCount: rows.filter((row) => row.status === 'NEW').length,
      duplicateCount: rows.filter((row) => row.status === 'DUPLICATE').length,
      errorCount: rows.filter((row) => row.status === 'ERROR').length,
      rows: rows.slice(0, 200).map(({ input: _input, ...row }) => row),
    };
  }

  async commit(ctx: CrmContext, input: LeadImportInput) {
    assertCrm(ctx, 'crm.manage');
    const rows = await this.evaluate(ctx, input);
    let created = 0;
    const errors: Array<{ row: number; errors: string[] }> = rows
      .filter((row) => row.status === 'ERROR')
      .map((row) => ({ row: row.row, errors: row.errors }));
    for (const row of rows) {
      if (row.status === 'ERROR' || !row.input) continue;
      if (row.status === 'DUPLICATE' && input.duplicates === 'SKIP') continue;
      try {
        await this.leads.create(ctx, row.input, { sourceKey: 'IMPORT' });
        created += 1;
      } catch (error) {
        errors.push({ row: row.row, errors: [String((error as Error).message ?? error)] });
      }
    }
    const duplicateCount = rows.filter((row) => row.status === 'DUPLICATE').length;
    const record = await this.prisma.$transaction(async (tx) => {
      const history = await tx.crmLeadImport.create({
        data: {
          dealerId: ctx.dealerId,
          fileName: input.fileName,
          totalRows: rows.length,
          createdCount: created,
          duplicateCount,
          errorCount: errors.length,
          errors: errors.slice(0, 1000),
          mapping: input.mapping,
          createdById: ctx.userId,
        },
      });
      await crmAudit(tx, ctx, {
        action: 'lead.imported',
        entityType: 'CrmLeadImport',
        entityId: history.id,
        after: {
          fileName: input.fileName,
          created,
          duplicates: duplicateCount,
          errors: errors.length,
        },
      });
      return history;
    });
    return record;
  }

  history(ctx: CrmContext) {
    return this.prisma.crmLeadImport.findMany({
      where: { dealerId: ctx.dealerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  private async evaluate(ctx: CrmContext, input: LeadImportInput): Promise<RowResult[]> {
    let table: string[][];
    try {
      table = parseCsv(input.csv).filter((cells) => !isBlankRow(cells));
    } catch (error) {
      throw new BadRequestException(
        error instanceof CsvParseError ? error.message : 'The file is not valid CSV',
      );
    }
    if (table.length < 2) throw new BadRequestException('The file has a header row but no leads');
    if (table.length - 1 > MAX_ROWS)
      throw new BadRequestException(`Import at most ${MAX_ROWS} leads at a time`);
    const header = table[0]!.map((cell) => cell.trim());
    const columns = new Map<LeadImportField, number>();
    for (const [column, field] of Object.entries(input.mapping)) {
      const index = header.indexOf(column);
      if (index >= 0) columns.set(field, index);
    }
    if (!columns.has('firstName') && !columns.has('fullName')) {
      throw new BadRequestException('Map a column to the first name (or full name)');
    }
    if (!columns.has('email') && !columns.has('phone')) {
      throw new BadRequestException('Map a column to the email or the phone number');
    }

    const [sources, statuses] = await Promise.all([
      this.prisma.crmLeadSource.findMany({ where: { dealerId: ctx.dealerId } }),
      this.prisma.crmLeadStatus.findMany({ where: { dealerId: ctx.dealerId } }),
    ]);
    const findSource = (value: string) => {
      const needle = value.trim().toLowerCase();
      return (
        sources.find((s) => s.key.toLowerCase() === needle || s.label.toLowerCase() === needle)
          ?.id ?? null
      );
    };
    const findStatus = (value: string) => {
      const needle = value.trim().toLowerCase();
      return (
        statuses.find((s) => s.key.toLowerCase() === needle || s.label.toLowerCase() === needle)
          ?.id ?? null
      );
    };

    // Existing leads with any email or phone in the file, fetched once.
    const cell = (cells: string[], field: LeadImportField) => {
      const index = columns.get(field);
      return index === undefined ? '' : (cells[index] ?? '').trim();
    };
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (const cells of table.slice(1)) {
      const email = normalizeEmail(cell(cells, 'email'));
      const phone = normalizePhone(cell(cells, 'phone'));
      if (email) emails.add(email);
      if (phone) phones.add(phone);
    }
    const existing = await this.prisma.crmLead.findMany({
      where: {
        dealerId: ctx.dealerId,
        mergedIntoId: null,
        OR: [{ emailNormalized: { in: [...emails] } }, { phoneNormalized: { in: [...phones] } }],
      },
      select: { id: true, number: true, emailNormalized: true, phoneNormalized: true },
    });
    const byEmail = new Map(
      existing.filter((l) => l.emailNormalized).map((l) => [l.emailNormalized!, l]),
    );
    const byPhone = new Map(
      existing.filter((l) => l.phoneNormalized).map((l) => [l.phoneNormalized!, l]),
    );
    const seenEmail = new Map<string, number>();
    const seenPhone = new Map<string, number>();

    return table.slice(1).map((cells, index): RowResult => {
      const rowNumber = index + 2;
      let firstName = cell(cells, 'firstName');
      let lastName = cell(cells, 'lastName');
      const fullName = cell(cells, 'fullName');
      if (!firstName && fullName) {
        const parts = fullName.split(/\s+/);
        firstName = parts[0] ?? '';
        lastName = lastName || parts.slice(1).join(' ');
      }
      const province = cell(cells, 'province').toUpperCase();
      const sourceText = cell(cells, 'source');
      const statusText = cell(cells, 'status');
      const errors: string[] = [];
      if (province && !(PROVINCES as readonly string[]).includes(province)) {
        errors.push(`Province "${province}" is not a Canadian province code`);
      }
      const sourceId = sourceText ? findSource(sourceText) : input.defaultSourceId;
      if (sourceText && !sourceId) errors.push(`Unknown source "${sourceText}"`);
      const statusId = statusText ? findStatus(statusText) : null;
      if (statusText && !statusId) errors.push(`Unknown status "${statusText}"`);

      const parsed = leadSchema.safeParse({
        firstName,
        lastName,
        email: cell(cells, 'email'),
        phone: cell(cells, 'phone'),
        city: cell(cells, 'city'),
        province: province && (PROVINCES as readonly string[]).includes(province) ? province : null,
        postalCode: cell(cells, 'postalCode'),
        sourceId,
        campaign: cell(cells, 'campaign'),
        interestedVin: cell(cells, 'vin'),
        budget: cell(cells, 'budget'),
        notes: cell(cells, 'notes'),
        statusId,
        tags: cell(cells, 'tags')
          .split(/[;|]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        // An imported list carries consent only when the dealer says it does.
        consent: input.consent ?? null,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          errors.push(`${issue.path.join('.') || 'row'}: ${issue.message}`);
      }
      const email = normalizeEmail(cell(cells, 'email'));
      const phone = normalizePhone(cell(cells, 'phone'));
      const name = [firstName, lastName].filter(Boolean).join(' ');
      if (errors.length || !parsed.success) {
        return { row: rowNumber, status: 'ERROR', name, email, phone, errors };
      }
      const existingMatch = (email && byEmail.get(email)) || (phone && byPhone.get(phone)) || null;
      const inFile = (email && seenEmail.get(email)) || (phone && seenPhone.get(phone)) || null;
      if (email) seenEmail.set(email, rowNumber);
      if (phone) seenPhone.set(phone, rowNumber);
      if (existingMatch || inFile) {
        return {
          row: rowNumber,
          status: 'DUPLICATE',
          name,
          email,
          phone,
          errors: [
            existingMatch
              ? `Matches lead #${existingMatch.number}`
              : `Same person as row ${inFile}`,
          ],
          duplicateOf: existingMatch
            ? { id: existingMatch.id, number: existingMatch.number }
            : null,
          input: parsed.data,
        };
      }
      return { row: rowNumber, status: 'NEW', name, email, phone, errors: [], input: parsed.data };
    });
  }
}
