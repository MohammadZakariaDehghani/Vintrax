import { Module } from '@nestjs/common';
import { UploadLimitsModule } from '../../common/upload-limits';
import { VideoProcessor } from '../../common/media/video-processor';
import { VehicleImagesModule } from '../vehicle-images/vehicle-images.module';
import { UploadsController } from './uploads.controller';
import { PromoVideoUploadsController } from './promo-video-uploads.controller';
import { PromoVideoUploadsService } from './promo-video-uploads.service';

@Module({
  imports: [UploadLimitsModule, VehicleImagesModule],
  controllers: [UploadsController, PromoVideoUploadsController],
  providers: [VideoProcessor, PromoVideoUploadsService],
  exports: [PromoVideoUploadsService],
})
export class UploadsModule {}
