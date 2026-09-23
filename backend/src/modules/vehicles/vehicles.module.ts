import { Module } from '@nestjs/common';
import { UploadLimitsModule } from '../../common/upload-limits';
import { VehicleImagesModule } from '../vehicle-images/vehicle-images.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [UploadLimitsModule, VehicleImagesModule],
  controllers: [VehiclesController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
