import { Module } from '@nestjs/common';
import { PromoTilesController } from './promo-tiles.controller';
import { PromoTilesService } from './promo-tiles.service';

@Module({
  controllers: [PromoTilesController],
  providers: [PromoTilesService],
})
export class PromoTilesModule {}
