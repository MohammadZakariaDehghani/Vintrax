import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { CarfaxExtractWorker } from './carfax-extract.worker';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, CarfaxExtractWorker],
  exports: [VehiclesService],
})
export class VehiclesModule {}
