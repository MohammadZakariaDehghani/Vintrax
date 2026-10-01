import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { HomeHeroController } from './home-hero.controller';
import { HomeHeroService } from './home-hero.service';

@Module({
  imports: [MediaModule],
  controllers: [HomeHeroController],
  providers: [HomeHeroService],
})
export class HomeHeroModule {}
