import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PROMO_VIDEO,
  startPromoVideoUploadSchema,
  type PromoVideoUploadSession,
  type PromoVideoUploadStatus,
  type StartPromoVideoUploadInput,
} from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { PromoVideoUploadsService } from './promo-video-uploads.service';

/**
 * Uploading a promo tile video in pieces:
 *
 *   1. `POST .../sessions` with the size and type → an upload id and piece size
 *   2. `POST .../sessions/:id/chunks/:index` for each piece, in order
 *   3. `POST .../sessions/:id/complete` → optimisation starts in the background
 *   4. `GET  .../sessions/:id` until `READY` (with the video and poster URLs) or `FAILED`
 *
 * No request carries more than one piece, so a reverse proxy's body limit
 * never sees the whole video, and no request waits for ffmpeg.
 */
@ApiTags('uploads')
@Controller('uploads/promo-tiles/video/sessions')
export class PromoVideoUploadsController {
  constructor(private readonly uploads: PromoVideoUploadsService) {}

  @Post()
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Start a promo tile video upload' })
  start(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(startPromoVideoUploadSchema)) input: StartPromoVideoUploadInput,
  ): Promise<PromoVideoUploadSession> {
    return this.uploads.start(user, input);
  }

  @Post(':id/chunks/:index')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send the next piece of a promo tile video' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: undefined,
      limits: { fileSize: PROMO_VIDEO.chunkBytes, files: 1 },
    }),
  )
  chunk(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<PromoVideoUploadStatus> {
    if (!file) throw new BadRequestException('No piece was sent');
    return this.uploads.appendChunk(user, id, index, file.buffer);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Finish sending a promo tile video and start optimising it' })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): PromoVideoUploadStatus {
    return this.uploads.complete(user, id);
  }

  @Get(':id')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'How a promo tile video upload is going' })
  status(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): PromoVideoUploadStatus {
    return this.uploads.status(user, id);
  }
}
