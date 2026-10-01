import { Module } from '@nestjs/common';
import {
  AdminArticlesController,
  ArticlesController,
  PagesController,
} from './articles.controller';
import { ArticlesService } from './articles.service';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule],
  controllers: [ArticlesController, PagesController, AdminArticlesController],
  providers: [ArticlesService],
})
export class ArticlesModule {}
