import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  adminEmailListQuerySchema,
  type AdminEmailListQuery,
  type AdminEmailRow,
  type EmailStats,
  type Paginated,
} from '@vintrax/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { MailService } from '../../common/mail/mail.service';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';

const statsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
});

/**
 * Admin → Emails (D-068). Reading needs `email:read`; retrying `email:manage`.
 *
 * A retry re-sends exactly what failed: the same template, recipient and
 * variables, taken from the log. Nothing in the request can change them, and a
 * message that carried a single-use link cannot be retried at all — its link
 * was never stored, and the person asks for a new one instead.
 */
@ApiTags('admin-emails')
@Controller('admin/emails')
export class EmailAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('email:read')
  @ApiOperation({ summary: 'The platform email log, newest first' })
  async list(
    @Query(zodQuery(adminEmailListQuerySchema)) query: AdminEmailListQuery,
  ): Promise<Paginated<AdminEmailRow>> {
    const where: Prisma.EmailMessageWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q ? { toEmail: { contains: query.q.toLowerCase() } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.emailMessage.count({ where }),
      this.prisma.emailMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          category: true,
          templateKey: true,
          toEmail: true,
          subject: true,
          status: true,
          provider: true,
          attempts: true,
          lastErrorCode: true,
          lastError: true,
          payload: true,
          createdAt: true,
          sentAt: true,
          deliveredAt: true,
          bouncedAt: true,
          failedAt: true,
        },
      }),
    ]);
    return {
      items: rows.map(({ payload, ...row }) => ({
        ...row,
        retryable: row.status === 'FAILED' && payload !== null,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        bouncedAt: row.bouncedAt?.toISOString() ?? null,
        failedAt: row.failedAt?.toISOString() ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  @Get('stats')
  @RequirePermissions('email:read')
  @ApiOperation({ summary: 'Counts by status and category over a window (default 7 days)' })
  stats(@Query(zodQuery(statsQuerySchema)) query: { hours: number }): Promise<EmailStats> {
    return this.mail.stats(new Date(Date.now() - query.hours * 60 * 60_000));
  }

  @Post(':id/retry')
  @RequirePermissions('email:manage')
  @ApiOperation({ summary: 'Queue a failed message to be sent again, unchanged' })
  async retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() admin: AuthUser,
  ): Promise<{ queued: true }> {
    const outcome = await this.mail.retry(id);
    if (outcome === 'not_found') throw new NotFoundException('Email not found');
    if (outcome === 'not_retryable') {
      throw new BadRequestException(
        'Only a failed message without a single-use link, to an address that has not bounced or complained, can be retried',
      );
    }
    await this.audit.record({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'email.retried',
      entityType: 'EmailMessage',
      entityId: id,
    });
    return { queued: true };
  }
}
