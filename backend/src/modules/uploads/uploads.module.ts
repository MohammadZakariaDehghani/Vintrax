import { Module } from '@nestjs/common';
import { UploadLimitsModule } from '../../common/upload-limits';
import { VehicleImagesModule } from '../vehicle-images/vehicle-images.module';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [UploadLimitsModule, VehicleImagesModule],
  controllers: [UploadsController],
})
export class UploadsModule {}
