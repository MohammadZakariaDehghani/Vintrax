import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { Env } from '../../config/env';
import { Public } from '../../common/decorators';
import { MailService } from '../../common/mail/mail.service';
import { verifyResendWebhook } from '../../common/mail/resend.transport';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DispatcherService } from '../crm/email/dispatcher.service';
import { mapResendEvent, type ResendWebhookEvent } from './resend-events';

/**
 * Resend's delivery webhook (D-068): POST /api/webhooks/resend.
 *
 * Nothing in the body is trusted until the signature over the unmodified raw
 * bytes checks out (the SDK's Standard Webhooks verification, which also
 * refuses a timestamp outside its window, so a captured request cannot be
 * replayed later). Each event id is processed once: a redelivery is
 * acknowledged and ignored. Events update the platform email log and the CRM
 * outbox, whichever sent the message; a hard bounce or complaint suppresses the
 * address for both. Responses carry no customer data.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);
  private readonly secret?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly crm: DispatcherService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('RESEND_WEBHOOK_SECRET', { infer: true }) ?? undefined;
  }

  @Public()
  // Authenticated by signature, and Resend batches from a few addresses: the
  // per-IP request limit would drop legitimate deliveries.
  @SkipThrottle()
  @Post('resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend delivery events (signed; configure in the Resend dashboard)' })
  async resend(
    @Req() request: RawBodyRequest<Request>,
    @Headers('svix-id') id: string | undefined,
    @Headers('svix-timestamp') timestamp: string | undefined,
    @Headers('svix-signature') signature: string | undefined,
  ): Promise<{ received: true; duplicate?: true }> {
    if (!this.secret) throw new NotFoundException();
    const raw = request.rawBody?.toString('utf8');
    if (!raw || !id || !timestamp || !signature || id.length > 200) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    let event: ResendWebhookEvent;
    try {
      event = verifyResendWebhook(raw, { id, timestamp, signature }, this.secret) as ResendWebhookEvent;
    } catch {
      this.logger.warn('webhook.resend.rejected: signature or timestamp did not verify');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const seen = await this.prisma.emailWebhookEvent.findUnique({ where: { id }, select: { id: true } });
    if (seen) return { received: true, duplicate: true };

    const mapped = mapResendEvent(event);
    if (mapped) {
      if (mapped.platform) {
        await this.mail.applyProviderEvent({
          providerMessageId: mapped.providerMessageId,
          status: mapped.platform.status,
          detail: mapped.platform.detail,
          occurredAt: mapped.occurredAt,
        });
      }
      if (mapped.crm) {
        await this.crm.providerEvent({
          messageId: mapped.providerMessageId,
          type: mapped.crm.type,
          detail: mapped.crm.detail,
          permanent: mapped.crm.permanent,
        });
      }
      if (mapped.suppress) {
        // The address comes from our own record of the message, not from the
        // event body.
        const address = await this.recipientOf(mapped.providerMessageId);
        if (address) await this.mail.suppress(address, mapped.suppress, `Resend ${event.type}`);
      }
    }

    // Recorded after processing: if processing fails, the 500 makes Resend
    // retry, and the retry is not mistaken for a duplicate.
    try {
      await this.prisma.emailWebhookEvent.create({
        data: {
          id,
          provider: 'resend',
          type: String(event.type).slice(0, 64),
          providerMessageId: mapped?.providerMessageId ?? null,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
    this.logger.log(`webhook.resend type=${String(event.type).slice(0, 64)} event=${id} applied=${!!mapped}`);
    return { received: true };
  }

  private async recipientOf(providerMessageId: string): Promise<string | null> {
    const platform = await this.prisma.emailMessage.findFirst({
      where: { providerMessageId },
      select: { toEmail: true },
    });
    if (platform) return platform.toEmail;
    const crm = await this.prisma.crmEmail.findFirst({
      where: { providerMessageId },
      select: { toEmail: true },
    });
    return crm?.toEmail ?? null;
  }
}
