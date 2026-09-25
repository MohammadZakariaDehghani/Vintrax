import { Module } from '@nestjs/common';
import { CarValueController } from './car-value.controller';
import { CarValueService } from './car-value.service';

@Module({
  controllers: [CarValueController],
  providers: [CarValueService],
})
export class CarValueModule {}
