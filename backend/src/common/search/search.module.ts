import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../../config/env';
import { OpenSearchProvider } from './opensearch.provider';
import { PostgresSearchProvider } from './postgres-search.provider';
import { SEARCH_PROVIDER, type SearchProvider } from './search.types';

/**
 * Binds the configured search backend.
 *
 * PostgreSQL is always constructed, because the OpenSearch provider uses it as
 * a fallback when the cluster is unreachable.
 */
@Global()
@Module({
  providers: [
    PostgresSearchProvider,
    {
      provide: SEARCH_PROVIDER,
      inject: [ConfigService, PrismaService, PostgresSearchProvider],
      useFactory: (
        config: ConfigService<Env, true>,
        prisma: PrismaService,
        postgres: PostgresSearchProvider,
      ): SearchProvider => {
        const provider = config.get('SEARCH_PROVIDER', { infer: true });
        if (provider === 'opensearch') {
          return new OpenSearchProvider(config, prisma, postgres);
        }
        return postgres;
      },
    },
  ],
  exports: [SEARCH_PROVIDER, PostgresSearchProvider],
})
export class SearchModule {}
