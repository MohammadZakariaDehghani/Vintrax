import { Module } from '@nestjs/common';
import { SearchIndexController } from './search-index.controller';
import { SearchIndexWorker } from './search-index.worker';

@Module({
  controllers: [SearchIndexController],
  providers: [SearchIndexWorker],
})
export class SearchIndexModule {}
