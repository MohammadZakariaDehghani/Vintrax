import { Module } from '@nestjs/common';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Imports VehiclesModule rather than reimplementing it: slug generation and
 * the post-write search reindex are the vehicles service's rules, and a second
 * copy in the importer is a second copy to keep correct.
 */
@Module({
  imports: [VehiclesModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
