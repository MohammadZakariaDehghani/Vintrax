import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { PromoTilesController } from './promo-tiles.controller';
import { PromoTilesService } from './promo-tiles.service';

@Module({
  imports: [MediaModule],
  controllers: [PromoTilesController],
  providers: [PromoTilesService],
})
export class PromoTilesModule {}
