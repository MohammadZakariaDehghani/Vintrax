import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MEDIA_IMAGE,
  MEDIA_VIDEO,
  mediaAssetQuerySchema,
  startMediaVideoUploadSchema,
  updateMediaAssetSchema,
  type MediaAsset,
  type MediaAssetQuery,
  type MediaUsage,
  type MediaVideoUploadStatus,
  type Paginated,
  type PromoVideoUploadSession,
  type PromoVideoUploadStatus,
  type StartMediaVideoUploadInput,
  type UpdateMediaAssetInput,
} from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { PromoVideoUploadsService } from '../uploads/promo-video-uploads.service';
import { MEDIA_FOLDER, MediaLibraryService, labelFromFilename } from './media-library.service';

/**
 * The media library. Everything here needs `content:manage`, the permission
 * every other home page editor already requires; nothing here is public —
 * visitors only ever see the URLs content stores.
 */
@ApiTags('media')
@Controller()
export class MediaLibraryController {
  constructor(
    private readonly library: MediaLibraryService,
    private readonly videos: PromoVideoUploadsService,
    private readonly audit: AuditService,
  ) {}

  @Get('admin/media')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'The media library, newest first' })
  list(
    @Query(zodQuery(mediaAssetQuerySchema)) query: MediaAssetQuery,
  ): Promise<Paginated<MediaAsset>> {
    return this.library.list(query);
  }

  @Get('admin/media/:id')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'One picture or video in the library' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<MediaAsset> {
    return this.library.get(id);
  }

  @Get('admin/media/:id/usage')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Where on the site a picture or video is shown' })
  usage(@Param('id', ParseUUIDPipe) id: string): Promise<MediaUsage[]> {
    return this.library.usages(id);
  }

  @Patch('admin/media/:id')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Rename a picture or video, or change its description' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateMediaAssetSchema)) input: UpdateMediaAssetInput,
    @CurrentUser() user: AuthUser,
  ): Promise<MediaAsset> {
    const asset = await this.library.update(id, input);
    await this.record(user, 'content.media.updated', id);
    return asset;
  }

  @Delete('admin/media/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Delete a picture or video and its files',
    description: 'Refused with 409, naming the content, while anything on the site shows it.',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.library.remove(id);
    await this.record(user, 'content.media.deleted', id);
  }

  @Post('uploads/media/images')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Add a picture to the media library',
    description:
      'JPEG, PNG, WebP or AVIF, recognised by its bytes — the filename and declared type are not trusted. ' +
      'Stored only as responsive WebP renditions, with all metadata removed. Optional form field `label`.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: undefined,
      limits: { fileSize: MEDIA_IMAGE.maxUploadBytes, files: 1, fields: 4 },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('label') label: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<MediaAsset> {
    if (!file) throw new BadRequestException('No file was uploaded');
    // The bytes decide below; this only turns away an obvious non-picture early.
    if (file.mimetype && !file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Upload a JPEG, PNG, WebP or AVIF picture.');
    }
    const asset = await this.library.addImage(file.buffer, {
      label: cleanLabel(label) ?? labelFromFilename(file.originalname, 'Picture'),
      createdById: user.id,
    });
    await this.record(user, 'content.media.created', asset.id);
    return asset;
  }

  /**
   * Videos come in pieces, exactly as promo tile videos do — see
   * `PromoVideoUploadsController` — and are re-encoded in the background with
   * a phone rendition. Once READY, the status carries the new asset's id.
   */
  @Post('uploads/media/videos/sessions')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Start adding a video to the media library' })
  startVideo(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(startMediaVideoUploadSchema)) input: StartMediaVideoUploadInput,
  ): Promise<PromoVideoUploadSession> {
    const label = input.label ?? 'Video';
    return this.videos.start(user, input, {
      folder: MEDIA_FOLDER,
      smallWidth: MEDIA_VIDEO.smallWidth,
      register: async (stored) => {
        const id = await this.library.addVideo(stored, { label, createdById: user.id });
        await this.record(user, 'content.media.created', id);
        return id;
      },
    });
  }

  @Post('uploads/media/videos/sessions/:id/chunks/:index')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send the next piece of a media library video' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: undefined,
      limits: { fileSize: MEDIA_VIDEO.chunkBytes, files: 1 },
    }),
  )
  async videoChunk(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MediaVideoUploadStatus> {
    if (!file) throw new BadRequestException('No piece was sent');
    return this.withAsset(user, await this.videos.appendChunk(user, id, index, file.buffer));
  }

  @Post('uploads/media/videos/sessions/:id/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Finish sending a media library video and start optimising it' })
  completeVideo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): MediaVideoUploadStatus {
    return this.withAsset(user, this.videos.complete(user, id));
  }

  @Get('uploads/media/videos/sessions/:id')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'How a media library video upload is going' })
  videoStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): MediaVideoUploadStatus {
    return this.withAsset(user, this.videos.status(user, id));
  }

  /** The status without the stored URLs — the asset has them — and with its id. */
  private withAsset(user: AuthUser, status: PromoVideoUploadStatus): MediaVideoUploadStatus {
    const { result: _result, ...rest } = status;
    return { ...rest, assetId: this.videos.assetIdOf(user, status.uploadId) };
  }

  private record(user: AuthUser, action: string, entityId: string): Promise<void> {
    return this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action,
      entityType: 'MediaAsset',
      entityId,
      metadata: null,
    });
  }
}

/** A multipart text field as a label, or nothing usable. */
function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.replace(/\s+/g, ' ').trim().slice(0, 120);
  return label || null;
}
