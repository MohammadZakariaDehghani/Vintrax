import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { Audit, RequirePermissions } from '../../common/decorators';
import { SEARCH_PROVIDER, type SearchProvider } from '../../common/search/search.types';

@ApiTags('admin')
@Controller('admin/search')
export class SearchIndexController {
  constructor(@Inject(SEARCH_PROVIDER) private readonly search: SearchProvider) {}

  @Post('reindex')
  @RequirePermissions('settings:manage')
  @Audit('search.reindexed', 'SearchIndex')
  @ApiOperation({
    summary: 'Rebuild the search index from the database',
    description: 'A no-op when SEARCH_PROVIDER=postgres, which reads the live table.',
  })
  reindex(): Promise<{ indexed: number }> {
    return this.search.reindexAll();
  }
}
