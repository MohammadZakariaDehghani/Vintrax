import { createReadStream } from 'node:fs';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  MAX_PAGE_SIZE,
  type BulkDeleteVehiclesInput,
  type BulkListingStatusInput,
  type BulkModerateListingsInput,
  type BulkVehicleResult,
  type CreateVehicleInput,
  type ModerateListingInput,
  type ReplaceVehicleHistoryInput,
  type Paginated,
  type SearchVehiclesQuery,
  type UpdateListingStatusInput,
  type UpdateVehicleInput,
  type SellerContact,
  type VehicleDetail,
  type VehicleImage,
  type VehicleSearchResponse,
  type VehicleSummary,
  createVehicleSchema,
  bulkDeleteVehiclesSchema,
  bulkListingStatusSchema,
  bulkModerateListingsSchema,
  moderateListingSchema,
  replaceVehicleHistorySchema,
  searchVehiclesSchema,
  updateListingStatusSchema,
  updateVehicleSchema,
} from '@vintrax/shared';
import { z } from 'zod';
import {
  Audit,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { VehiclesService } from './vehicles.service';

const myVehiclesQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'IN_AUCTION', 'SOLD', 'ARCHIVED'])
    .optional(),
  /** Free text over the caller's own inventory. See `VehiclesService.listMine`. */
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

/**
 * The moderation queue's paging. Up to the server-wide 100, which is the
 * largest page size the admin lists offer; a lower cap here once turned
 * "100 per page" into "Validation failed".
 */
export const pendingReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

@ApiTags('vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Search vehicles',
    description:
      'Filters, sorting and pagination follow the searchVehiclesSchema contract in @vintrax/shared. ' +
      'Authenticating is optional; with a token each result carries its isFavourited flag.',
  })
  search(
    @Query(zodQuery(searchVehiclesSchema)) query: SearchVehiclesQuery,
    @CurrentUser() user?: AuthUser,
  ): Promise<VehicleSearchResponse> {
    return this.vehicles.searchVehicles(query, user);
  }

  // Literal segments are declared before ':id' so they are not captured as ids.
  @Get('mine')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: "Return the caller's own vehicles, including drafts" })
  listMine(
    @Query(zodQuery(myVehiclesQuerySchema)) query: z.infer<typeof myVehiclesQuerySchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<VehicleSummary>> {
    return this.vehicles.listMine(user, query.page, query.pageSize, query.status, query.q);
  }

  @Get('pending-review')
  @RequirePermissions('vehicle:publish', 'user:read')
  @ApiOperation({ summary: 'List vehicles awaiting moderation' })
  listPendingReview(
    @Query(zodQuery(pendingReviewQuerySchema)) query: z.infer<typeof pendingReviewQuerySchema>,
  ): Promise<Paginated<VehicleSummary>> {
    return this.vehicles.listPendingReview(query.page, query.pageSize);
  }

  @Public()
  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Return a single vehicle by id or slug' })
  findOne(
    @Param('idOrSlug') idOrSlug: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<VehicleDetail> {
    return this.vehicles.findById(idOrSlug, user);
  }

  /**
   * Signed-in only — the global guard applies, as this is not `@Public` — and
   * throttled well below the global limit, so a signed-in account cannot walk
   * the catalogue collecting every seller's number.
   */
  @Get(':id/contact')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "The seller's phone number, for a signed-in visitor" })
  sellerContact(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SellerContact> {
    return this.vehicles.sellerContact(id, user);
  }

  @Get(':id/documents/:documentId')
  @ApiOperation({
    summary: 'Download a vehicle document',
    description:
      'The seller, an administrator, or the buyer on a live order. Documents are not served as ' +
      'static files, so this route is the only way to read one and it authorizes every request.',
  })
  async downloadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | void> {
    const { location, filename } = await this.vehicles.openDocument(id, documentId, user);

    if (location.kind === 'remote') {
      // Object storage serves the bytes; the authorization decision was made here.
      response.redirect(HttpStatus.FOUND, location.url);
      return;
    }

    response.set({
      'Content-Type': location.contentType,
      // Always an attachment: paperwork is never something the browser should
      // render inline on this origin.
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(createReadStream(location.path));
  }

  @Post()
  @RequirePermissions('vehicle:write')
  @Audit('vehicle.created', 'Vehicle')
  @ApiOperation({ summary: 'Create a vehicle listing' })
  create(
    @Body(zodBody(createVehicleSchema)) body: CreateVehicleInput,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleDetail> {
    return this.vehicles.create(body, user);
  }

  // The two bulk routes are declared before `@Patch(':id')` on purpose. Nest
  // matches in declaration order, so below this point `bulk-status` would be
  // read as an id and rejected by ParseUUIDPipe.
  //
  // Neither carries `@Audit`: that decorator takes its entity id from
  // `request.params.id`, which a bulk route does not have, and would file one
  // entry with a null id. The service writes one entry per vehicle instead.

  @Patch('bulk-status')
  @RequirePermissions('vehicle:write')
  @ApiOperation({
    summary: 'Move many listings the caller owns between seller-controlled statuses',
    description:
      'Each vehicle is applied through the same path as the single-vehicle endpoint, so every ' +
      'transition rule and guard still holds. Partial success is normal: each id comes back with ' +
      'its own result, and one refusal does not undo the rest.',
  })
  setStatusMany(
    @Body(zodBody(bulkListingStatusSchema)) body: BulkListingStatusInput,
    @CurrentUser() user: AuthUser,
  ): Promise<BulkVehicleResult> {
    return this.vehicles.setStatusMany(body, user);
  }

  @Patch('bulk-moderate')
  @RequirePermissions('vehicle:publish', 'user:manage')
  @ApiOperation({
    summary: 'Approve or reject many vehicles awaiting review',
    description:
      'Publishing stays a moderation decision made one vehicle at a time internally; this only ' +
      'saves the reviewer the clicks. Each id carries its own result.',
  })
  moderateMany(
    @Body(zodBody(bulkModerateListingsSchema)) body: BulkModerateListingsInput,
    @CurrentUser() actor: AuthUser,
  ): Promise<BulkVehicleResult> {
    return this.vehicles.moderateMany(body, actor);
  }

  @Post('bulk-delete')
  @RequirePermissions('vehicle:delete')
  @ApiOperation({
    summary: 'Delete many vehicles in one action',
    description:
      'POST rather than DELETE because it carries a body, and requires confirm: true so a ' +
      'destructive request cannot be one character away from a harmless one. Each id runs ' +
      'through the single-vehicle delete, so the live-auction and sales-record guards hold and ' +
      'a seller still reaches only their own vehicles. Each deletion audits itself.',
  })
  removeMany(
    @Body(zodBody(bulkDeleteVehiclesSchema)) body: BulkDeleteVehiclesInput,
    @CurrentUser() user: AuthUser,
  ): Promise<BulkVehicleResult> {
    return this.vehicles.removeMany(body, user);
  }

  @Patch(':id')
  @RequirePermissions('vehicle:write')
  @Audit('vehicle.updated', 'Vehicle')
  @ApiOperation({
    summary: 'Update a vehicle the caller owns',
    description:
      'Listing status is not editable here — use PATCH /vehicles/:id/status, or admin moderation to publish.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateVehicleSchema)) body: UpdateVehicleInput,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleDetail> {
    return this.vehicles.update(id, body, user);
  }

  @Patch(':id/status')
  @RequirePermissions('vehicle:write')
  @Audit('vehicle.status_changed', 'Vehicle')
  @ApiOperation({
    summary: 'Move a listing between the statuses its seller controls',
    description:
      'Submit for review, withdraw, archive or return to draft. Publishing is not among them: ' +
      'ACTIVE is reached only through admin moderation, so a seller cannot approve their own listing.',
  })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateListingStatusSchema)) body: UpdateListingStatusInput,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleDetail> {
    return this.vehicles.setStatus(id, body, user);
  }

  @Put(':id/history')
  @RequirePermissions('vehicle:write')
  @Audit('vehicle.history_updated', 'Vehicle')
  @ApiOperation({
    summary: "Replace a vehicle's own seller-entered history rows",
    description:
      'The seller transcribes a report they hold and this does not verify the entries; the ' +
      "uploaded document is the evidence, and the interface presents these rows as the seller's " +
      'own account.',
  })
  replaceHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(replaceVehicleHistorySchema)) body: ReplaceVehicleHistoryInput,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleDetail> {
    return this.vehicles.replaceHistory(id, body, user);
  }

  @Post(':id/images')
  @RequirePermissions('vehicle:write')
  @Audit('vehicle.image_added', 'Vehicle')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Add a photo to a vehicle the caller owns',
    description:
      'Processed like POST /uploads/images (documentation/images.md) and appended to the ' +
      'listing in the same request.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  addImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleImage> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.vehicles.addImage(id, file.buffer, user);
  }

  @Put(':id/images/:imageId')
  @RequirePermissions('vehicle:write')
  @Audit('vehicle.image_replaced', 'Vehicle')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Replace the file behind one photo, keeping its position',
    description:
      'The new photo is processed and stored before the listing switches to it; the old ' +
      'files are removed afterwards.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  replaceImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<VehicleImage> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.vehicles.replaceImage(id, imageId, file.buffer, user);
  }

  @Delete(':id/images/:imageId')
  @RequirePermissions('vehicle:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('vehicle.image_removed', 'Vehicle')
  @ApiOperation({ summary: 'Remove one photo and its files. Idempotent.' })
  async removeImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.vehicles.removeImage(id, imageId, user);
  }

  @Delete(':id')
  @RequirePermissions('vehicle:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('vehicle.deleted', 'Vehicle')
  @ApiOperation({ summary: 'Delete a vehicle the caller owns' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.vehicles.remove(id, user);
  }

  @Patch(':id/moderate')
  @RequirePermissions('vehicle:publish', 'user:manage')
  @Audit('vehicle.moderated', 'Vehicle')
  @ApiOperation({ summary: 'Approve or reject a vehicle awaiting review' })
  moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(moderateListingSchema)) body: ModerateListingInput,
    @CurrentUser() actor: AuthUser,
  ): Promise<VehicleDetail> {
    return this.vehicles.moderate(id, body, actor);
  }
}
