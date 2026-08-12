import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { SEARCH_PROVIDER, type SearchProvider } from '../../common/search/search.types';
import { Public } from '../../common/decorators';

interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  checks: {
    database: 'up' | 'down';
    redis: 'up' | 'down' | 'disabled';
    search: { provider: string; status: 'up' | 'down' };
  };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(SEARCH_PROVIDER) private readonly search: SearchProvider,
  ) {}

  /**
   * Readiness probe.
   *
   * The database is the only hard dependency: without it nothing works, so a
   * failure is 503 and the instance should leave the load balancer pool. Redis
   * and a search cluster being down degrade the service rather than break it,
   * so they are reported but do not fail the check.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and dependency readiness probe' })
  async check(): Promise<HealthReport> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    if (database === 'down') {
      throw new ServiceUnavailableException('Database is unreachable');
    }

    const searchHealthy = await this.search.isHealthy();

    return {
      status: searchHealthy && this.redis.isAvailable ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env['npm_package_version'] ?? '1.0.0',
      checks: {
        database,
        redis: this.redis.isAvailable ? 'up' : 'down',
        search: { provider: this.search.name, status: searchHealthy ? 'up' : 'down' },
      },
    };
  }

  /** Kubernetes liveness: is the process itself alive, regardless of deps. */
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
