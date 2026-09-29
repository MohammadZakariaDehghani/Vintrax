import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
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

/** A dependency that has not answered by now is reported as down. */
const CHECK_TIMEOUT_MS = 3_000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// Probes come from the load balancer and the container runtime, often through
// the same proxy address as visitors; they must neither use up nor be refused
// by the visitors' rate limit.
@SkipThrottle()
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
    // Bounded, so a hung connection pool fails the probe instead of hanging it.
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`);
    } catch {
      database = 'down';
    }

    if (database === 'down') {
      throw new ServiceUnavailableException('Database is unreachable');
    }

    const searchHealthy = await withTimeout(this.search.isHealthy()).catch(() => false);

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
