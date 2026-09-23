import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UploadedVehicleImage } from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { StorageService, type StoredObject } from '../../common/storage/storage.service';
import { VehicleImagesService } from '../vehicle-images/vehicle-images.service';

/**
 * Binary uploads.
 *
 * Files are held in memory and only written after validation passes, so nothing
 * untrusted ever touches disk. The stored filename is generated and the
 * extension comes from the validated MIME type, which removes any
 * path-traversal or extension-spoofing surface.
 */
@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly vehicleImages: VehicleImagesService,
  ) {}

  @Post('images')
  @RequirePermissions('vehicle:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a vehicle photo',
    description:
      'Validates the photo by its content, then generates responsive WebP renditions ' +
      '(documentation/images.md). Returns `url` — an optimized rendition, never the ' +
      'original — to reference in a vehicle payload, plus every rendition in `optimized`. ' +
      'The filename and declared MIME type are ignored.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<UploadedVehicleImage> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.vehicleImages.ingest(file.buffer, { uploadedById: user.id });
  }

  @Post('inspection-images')
  @RequirePermissions('inspection:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an inspection photo' })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadInspectionImage(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'inspections',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Post('body-type-images')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a body-type shortcut photo',
    description:
      'Returns a URL to pass to PUT /admin/body-type-images/:bodyType. Separate from vehicle photos because it is an operator action, not a seller one, and carries a different permission.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadBodyTypeImage(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'body-types',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Post('make-logos')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: "Upload a vehicle make's logo",
    description:
      'Returns a URL to pass to PUT /admin/make-logos/:make. Overrides the generated mark ' +
      'the popular-makes row otherwise draws for that make.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadMakeLogo(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'make-logos',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Post('partners')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a partner logo',
    description: 'Returns a URL to pass to POST /admin/partners or PUT /admin/partners/:id.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadPartnerLogo(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'partners',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Post('article-images')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a hero photograph for an editorial post',
    description: 'Returns a URL to pass as heroImageUrl when writing or editing a post.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadArticleImage(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'articles',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Post('documents')
  @RequirePermissions('vehicle:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a vehicle document such as a title or CarFax report' })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadDocument(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadDocument({
      folder: 'documents',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }
}
