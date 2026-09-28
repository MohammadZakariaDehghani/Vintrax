import { Module } from '@nestjs/common';
import { VehicleImagesModule } from '../vehicle-images/vehicle-images.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { DealerInventoryController } from './dealer-inventory.controller';
import { DealerInventoryService } from './dealer-inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryPhotosService } from './inventory-photos.service';
import { InventoryService } from './inventory.service';

/**
 * Imports VehiclesModule rather than reimplementing it: slug generation and
 * the post-write search reindex are the vehicles service's rules, and a second
 * copy in the importer is a second copy to keep correct.
 */
@Module({
  imports: [VehiclesModule, VehicleImagesModule],
  controllers: [InventoryController, DealerInventoryController],
  providers: [InventoryService, InventoryPhotosService, DealerInventoryService],
})
export class InventoryModule {}
