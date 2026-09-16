import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MAX_INVENTORY_CSV_BYTES,
  PROVINCES,
  type InventoryImportLocation,
  type InventoryImportPlan,
  type InventoryImportRecord,
  type InventoryImportResult,
  type InventoryRowResult,
  type Paginated,
  type Province,
} from '@vintrax/shared';
import { z } from 'zod';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { InventoryService } from './inventory.service';

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
});

/**
 * The location a dealer chose for this import, read from the upload form.
 *
 * This is not an exception to the rule that the request never names an owner.
 * A city is a property of the listing, the same field the single-vehicle form
 * already lets a seller type, and it only ever applies to the caller's own
 * rows. What a request still cannot do is say whose inventory it is writing to.
 *
 * Optional, and a fallback only: a file that gives a city keeps its own. An
 * unrecognised province is refused rather than dropped, because dropping it
 * would fall through to the profile and place the vehicles somewhere the dealer
 * did not ask for.
 */
function readLocation(body: Record<string, unknown> | undefined): InventoryImportLocation {
  const city = text(body?.['defaultCity']);
  const province = text(body?.['defaultProvince']);

  if (city !== null && city.length > 80) {
    throw new BadRequestException('The city for this import is longer than 80 characters.');
  }

  if (province !== null && !PROVINCES.includes(province as Province)) {
    throw new BadRequestException(
      `"${province}" is not a Canadian province or territory code. Use one of: ${PROVINCES.join(', ')}.`,
    );
  }

  return { city, province: (province as Province | null) ?? null };
}

/** A form field as text, with absent and blank treated alike. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether to download the photos the file points at. Defaults to yes.
 *
 * Opt-*out* rather than opt-in: a dealer who put photo URLs in the file meant
 * for them to be used. The switch exists for the reprice case, where the file
 * is three columns and re-checking a thousand photo addresses is pure delay.
 */
function readPhotoChoice(body: Record<string, unknown> | undefined): boolean {
  const value = text(body?.['importPhotos']);
  if (value === null) return true;
  return !['false', '0', 'no', 'off'].includes(value.toLowerCase());
}

/**
 * Bulk inventory, as CSV.
 *
 * Under `vehicle:write`, which SELLER, DEALER, ADMIN and SUPER_ADMIN already
 * hold: this is the same authority as creating and editing a listing, applied
 * to many at once, so it needs no new permission. Every route acts on the
 * caller's own inventory and takes the owner from the JWT — no route accepts a
 * seller or dealer id, from the query, the body or the file.
 *
 * Multer keeps the upload in memory and it is only read after the size and
 * encoding checks pass, matching `UploadsController`: nothing untrusted reaches
 * disk, and there is no filename to traverse with.
 */
@ApiTags('inventory')
@Controller('dealer/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('import/template')
  @RequirePermissions('vehicle:write')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vintrax-inventory-template.csv"')
  @ApiOperation({ summary: 'Download a blank inventory CSV with documented headers' })
  template(): string {
    return this.inventory.template();
  }

  @Get('export')
  @RequirePermissions('vehicle:write')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vintrax-inventory.csv"')
  @ApiOperation({
    summary: "Export the caller's own inventory",
    description:
      'Uses the same schema the importer accepts, so an export can be edited and re-imported.',
  })
  export(@CurrentUser() user: AuthUser): Promise<string> {
    return this.inventory.exportInventory(user);
  }

  @Post('import/validate')
  @RequirePermissions('vehicle:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Check a CSV and report what it would do',
    description: 'Writes nothing. Returns a per-row plan and the file hash to confirm with.',
  })
  @UseInterceptors(
    FileInterceptor('file', { storage: undefined, limits: { fileSize: MAX_INVENTORY_CSV_BYTES } }),
  )
  validate(
    @CurrentUser() user: AuthUser,
    @Body() body?: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<InventoryImportPlan> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.inventory.validate(file, user, readLocation(body));
  }

  @Post('import/confirm')
  @RequirePermissions('vehicle:write')
  @Audit('inventory.imported', 'InventoryImport')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Apply a previewed CSV',
    description:
      'Requires the fileHash returned by validate, so the file applied is the file previewed. Valid rows are written and invalid rows are reported and skipped. Photos named by the file are downloaded after the response, and their progress is on the import record.',
  })
  @UseInterceptors(
    FileInterceptor('file', { storage: undefined, limits: { fileSize: MAX_INVENTORY_CSV_BYTES } }),
  )
  confirm(
    @CurrentUser() user: AuthUser,
    @Body() body?: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<InventoryImportResult> {
    if (!file) throw new BadRequestException('No file was uploaded');
    const fileHash = text(body?.['fileHash']);
    if (!fileHash) {
      throw new BadRequestException('fileHash is required — preview the import first.');
    }
    // The same location the preview was built with. The client sends both, and
    // sending a different one only re-plans the file honestly — the counts in
    // the result are the counts that were applied, never the preview's.
    return this.inventory.confirm(file, fileHash, user, readLocation(body), readPhotoChoice(body));
  }

  @Get('imports')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: "List the caller's past imports" })
  history(
    @CurrentUser() user: AuthUser,
    @Query(zodQuery(historyQuerySchema)) query: z.infer<typeof historyQuerySchema>,
  ): Promise<Paginated<InventoryImportRecord>> {
    return this.inventory.history(user, query.page, query.pageSize);
  }

  @Get('imports/:id')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Read one past import, with its per-row outcomes' })
  historyDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<InventoryImportRecord & { rows: InventoryRowResult[] }> {
    return this.inventory.historyDetail(id, user);
  }
}
