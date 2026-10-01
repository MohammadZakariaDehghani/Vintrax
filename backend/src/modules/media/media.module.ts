import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { MediaLibraryController } from './media-library.controller';
import { MediaLibraryService } from './media-library.service';

/**
 * The media library, and the one place content turns an administrator's
 * choice of media into the URLs it stores (`MediaLibraryService.resolve`).
 * Imported by every module whose content shows media.
 */
@Module({
  imports: [UploadsModule],
  controllers: [MediaLibraryController],
  providers: [MediaLibraryService],
  exports: [MediaLibraryService],
})
export class MediaModule {}
