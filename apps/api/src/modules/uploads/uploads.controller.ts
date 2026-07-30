import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators';
import type { Env } from '../../config/env';

/**
 * Image types accepted for listing photos. The map is keyed by MIME type so the
 * stored extension comes from the validated type rather than the client filename.
 */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  private readonly uploadDir: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.uploadDir = resolve(this.config.get('UPLOAD_DIR', { infer: true }));
    mkdirSync(join(this.uploadDir, 'listings'), { recursive: true });
  }

  @Post('images')
  @Roles('DEALER', 'PRIVATE_SELLER')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a listing photo',
    description:
      'Returns a URL to reference in a listing payload. Local development writes to disk; ' +
      'production would swap this for object storage behind the same response shape.',
  })
  // Held in memory so the file is never written to disk before it passes validation.
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  upload(@UploadedFile() file?: Express.Multer.File): { url: string } {
    if (!file) throw new BadRequestException('No file was uploaded');

    const extension = ALLOWED_IMAGE_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        `Unsupported image type "${file.mimetype}". Allowed: ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')}`,
      );
    }

    const maxBytes = this.config.get('MAX_UPLOAD_BYTES', { infer: true });
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `Image is too large. Maximum size is ${Math.floor(maxBytes / 1024 / 1024)} MB`,
      );
    }

    // A generated name discards the client-supplied filename entirely, which
    // removes any path-traversal or extension-spoofing surface.
    const filename = `${randomUUID()}${extension}`;
    writeFileSync(join(this.uploadDir, 'listings', filename), file.buffer);

    return { url: `/uploads/listings/${filename}` };
  }
}
