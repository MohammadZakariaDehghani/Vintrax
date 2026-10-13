import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  emailConnectionTestSchema,
  emailSettingsUpdateSchema,
  type EmailConnectionTestInput,
  type EmailConnectionTestResult,
  type EmailSettingsUpdateInput,
  type EmailSettingsView,
  type EmailTestSendResult,
} from '@vintrax/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { EmailSettingsService } from '../../common/mail/email-settings.service';
import { MailService } from '../../common/mail/mail.service';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Per address, as the throttler counts: generous for setup, useless for abuse. */
const TEST_THROTTLE = { default: { limit: 5, ttl: 10 * 60_000 } };
/** Per administrator per hour, counted in the database so it holds across API processes. */
const TEST_EMAILS_PER_HOUR = 10;

/**
 * Admin → Settings → Email (D-069). Every route needs `settings:manage`, which
 * only super admins hold.
 *
 * The API key goes in and never comes out: responses carry whether a key is
 * set and its last four characters. The audit log records which fields
 * changed — "apiKey.replaced", never a value.
 */
@ApiTags('admin-settings')
@Controller('admin/settings/email')
export class EmailSettingsController {
  constructor(
    private readonly settings: EmailSettingsService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Email provider settings (the API key is never returned)' })
  get(): Promise<EmailSettingsView> {
    return this.settings.view();
  }

  @Put()
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Save the settings; a new API key replaces the stored one' })
  async update(
    @Body(zodBody(emailSettingsUpdateSchema)) body: EmailSettingsUpdateInput,
    @CurrentUser() admin: AuthUser,
  ): Promise<EmailSettingsView> {
    const changes = await this.settings.update(body, admin.id);
    if (changes.length) {
      await this.audit.record({
        actorId: admin.id,
        actorEmail: admin.email,
        action: 'settings.email_updated',
        entityType: 'EmailProviderSettings',
        entityId: null,
        // Field names only. The key's value is never written anywhere but the
        // encrypted column.
        metadata: { changes },
      });
    }
    return this.settings.view();
  }

  @Post('test-connection')
  @RequirePermissions('settings:manage')
  @Throttle(TEST_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check an API key (typed or stored) and the sending domain with Resend',
  })
  testConnection(
    @Body(zodBody(emailConnectionTestSchema)) body: EmailConnectionTestInput,
  ): Promise<EmailConnectionTestResult> {
    return this.settings.testConnection(body);
  }

  @Post('test-email')
  @RequirePermissions('settings:manage')
  @Throttle(TEST_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Send a test email to the signed-in admin's own verified address, through the active provider",
  })
  async testEmail(@CurrentUser() admin: AuthUser): Promise<EmailTestSendResult> {
    // Only ever to the admin's own, verified address — the request names no
    // recipient, so this cannot be turned into a way to email anyone else.
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      select: { email: true, emailVerified: true, firstName: true },
    });
    if (!account.emailVerified) {
      throw new BadRequestException('Verify your own email address first; the test is sent there.');
    }
    const recent = await this.prisma.emailMessage.count({
      where: {
        templateKey: 'settings.test-email',
        userId: admin.id,
        createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
      },
    });
    if (recent >= TEST_EMAILS_PER_HOUR) {
      throw new HttpException(
        `At most ${TEST_EMAILS_PER_HOUR} test emails an hour. Try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const result = await this.mail.sendTestEmail(account.email, account.firstName, admin.id);
    await this.audit.record({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'settings.email_test_sent',
      // The settings are a single row with no UUID; the type names it.
      entityType: 'EmailProviderSettings',
      entityId: null,
      metadata: { ok: result.ok },
    });
    return { ...result, to: account.email };
  }
}
