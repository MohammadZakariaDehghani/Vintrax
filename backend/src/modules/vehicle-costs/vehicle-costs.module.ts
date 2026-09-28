import { Module } from '@nestjs/common';
import { VehicleCostsController } from './vehicle-costs.controller';
import { VehicleCostsService } from './vehicle-costs.service';

@Module({
  controllers: [VehicleCostsController],
  providers: [VehicleCostsService],
})
export class VehicleCostsModule {}
