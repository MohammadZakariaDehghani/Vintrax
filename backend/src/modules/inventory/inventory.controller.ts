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
  type InventoryImportPlan,
  type InventoryImportRecord,
  type InventoryImportResult,
  type InventoryRowResult,
  type Paginated,
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
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<InventoryImportPlan> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.inventory.validate(file, user);
  }

  @Post('import/confirm')
  @RequirePermissions('vehicle:write')
  @Audit('inventory.imported', 'InventoryImport')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Apply a previewed CSV',
    description:
      'Requires the fileHash returned by validate, so the file applied is the file previewed. Valid rows are written and invalid rows are reported and skipped.',
  })
  @UseInterceptors(
    FileInterceptor('file', { storage: undefined, limits: { fileSize: MAX_INVENTORY_CSV_BYTES } }),
  )
  confirm(
    @CurrentUser() user: AuthUser,
    @Body('fileHash') fileHash?: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<InventoryImportResult> {
    if (!file) throw new BadRequestException('No file was uploaded');
    if (!fileHash) {
      throw new BadRequestException('fileHash is required — preview the import first.');
    }
    return this.inventory.confirm(file, fileHash, user);
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
