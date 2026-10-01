import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { HomeFeaturesController } from './home-features.controller';
import { HomeFeaturesService } from './home-features.service';

@Module({
  imports: [MediaModule],
  controllers: [HomeFeaturesController],
  providers: [HomeFeaturesService],
})
export class HomeFeaturesModule {}
