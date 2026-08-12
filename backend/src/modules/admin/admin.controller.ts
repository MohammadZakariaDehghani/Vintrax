import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AdminAnalytics, type AuditLogEntry, type AuditLogQuery, type Paginated, auditLogQuerySchema } from '@atlas/shared';
import { RequirePermissions } from '../../common/decorators';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../../common/audit/audit.service';
import { AdminService } from './admin.service';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get('analytics')
  @RequirePermissions('report:read')
  @ApiOperation({ summary: 'Platform-wide metrics for the admin dashboard' })
  analytics(): Promise<AdminAnalytics> {
    return this.admin.analytics();
  }

  @Get('audit-logs')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Query the audit trail' })
  auditLogs(
    @Query(zodQuery(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<Paginated<AuditLogEntry>> {
    return this.audit.query(query);
  }
}
