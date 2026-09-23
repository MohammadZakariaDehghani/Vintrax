import { Module } from '@nestjs/common';
import { VehicleImagesService } from './vehicle-images.service';

@Module({
  providers: [VehicleImagesService],
  exports: [VehicleImagesService],
})
export class VehicleImagesModule {}
