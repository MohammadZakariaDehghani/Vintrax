import { Module } from '@nestjs/common';
import { HomeFeaturesController } from './home-features.controller';
import { HomeFeaturesService } from './home-features.service';

@Module({
  controllers: [HomeFeaturesController],
  providers: [HomeFeaturesService],
})
export class HomeFeaturesModule {}
