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
import { removeFlatBackground } from './remove-background';

/** The image types body-type photos are accepted in, and so may be cut out of their backdrop. */
const CUTOUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

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
  async uploadBodyTypeImage(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    // The shortcuts are drawn as icons, with no frame behind them, so a car
    // photographed on a flat backdrop is cut out of it. A photograph of a
    // scene has no flat backdrop and is stored as sent.
    // Only a file the storage service would accept anyway is converted, so
    // the cut-out never becomes a way around its type and size checks.
    const cutOut =
      CUTOUT_TYPES.has(file.mimetype) && file.size <= this.storage.maxUploadBytes
        ? await removeFlatBackground(file.buffer)
        : null;
    return this.storage.uploadImage({
      folder: 'body-types',
      buffer: cutOut ?? file.buffer,
      contentType: cutOut ? 'image/png' : file.mimetype,
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

  @Post('footer-icons')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an icon for a footer link, such as a Facebook or Instagram logo',
    description: "Returns a URL to pass as a link's imageUrl in PUT /admin/footer.",
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadFooterIcon(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'footer-icons',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Post('site-images')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an image for a site page, such as the Contact page map',
    description: 'Returns a URL to pass as contactMapImageUrl in PUT /admin/site-settings.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadSiteImage(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'site',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Post('home-features')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload the photograph for a home page feature block',
    description: 'Returns a URL to pass as imageUrl to POST or PATCH /admin/home-features.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadHomeFeatureImage(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'home-features',
      buffer: file.buffer,
      contentType: file.mimetype,
      originalName: file.originalname,
    });
  }

  @Post('promo-tiles')
  @RequirePermissions('content:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload the photograph for a home page promo tile',
    description: 'Returns a URL to pass as imageUrl to PUT /admin/promo-tiles/:slot.',
  })
  @UseInterceptors(FileInterceptor('file', { storage: undefined }))
  uploadPromoTileImage(@UploadedFile() file?: Express.Multer.File): Promise<StoredObject> {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.storage.uploadImage({
      folder: 'promo-tiles',
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
