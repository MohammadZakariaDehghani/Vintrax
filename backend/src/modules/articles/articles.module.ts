import { Module } from '@nestjs/common';
import {
  AdminArticlesController,
  ArticlesController,
  PagesController,
} from './articles.controller';
import { ArticlesService } from './articles.service';

@Module({
  controllers: [ArticlesController, PagesController, AdminArticlesController],
  providers: [ArticlesService],
})
export class ArticlesModule {}
