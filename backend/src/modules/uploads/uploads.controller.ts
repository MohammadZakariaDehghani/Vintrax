import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators';
import { StorageService, type StoredObject } from '../../common/storage/storage.service';

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
  constructor(private readonly storage: StorageService) {}

  @Post('images')
  @RequirePermissions('vehicle:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a vehicle photo',
    description:
      'Returns a URL to reference in a vehicle payload. The response shape is identical for local and S3 storage.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadImage(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'vehicles',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
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
