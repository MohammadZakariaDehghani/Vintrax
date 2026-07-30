import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../../common/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and database readiness probe' })
  async check(): Promise<{ status: 'ok'; database: 'up'; uptimeSeconds: number }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      // Surfaced as 503 so orchestrators treat the instance as not ready.
      throw new ServiceUnavailableException('Database is unreachable');
    }
    return { status: 'ok', database: 'up', uptimeSeconds: Math.floor(process.uptime()) };
  }
}
