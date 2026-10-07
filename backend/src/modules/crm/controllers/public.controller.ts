import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../../../config/env';
import type { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Public } from '../../../common/decorators';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { CrmAccessService } from '../core/access.service';
import { DispatcherService } from '../email/dispatcher.service';
import { PIXEL } from '../email/tracking';

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const clickQuerySchema = z.object({ u: z.string().max(4000), s: z.string().max(64) });
const webhookSchema = z.object({
  messageId: z.string().min(1).max(500),
  type: z.enum(['DELIVERED', 'BOUNCED', 'COMPLAINED', 'OPENED', 'CLICKED', 'REPLIED']),
  detail: z.string().max(500).optional().nullable(),
  permanent: z.boolean().optional(),
});

/**
 * The CRM's public edges: open and click tracking, the unsubscribe page's
 * API (and RFC 8058 one-click), and an email provider's delivery webhook.
 * None needs a session; each works only with an email's opaque token, or —
 * for the webhook — the shared secret.
 */
@ApiTags('crm-public')
@Controller('crm')
export class CrmPublicController {
  private readonly webhookSecret?: string;
  private readonly appUrl: string;

  constructor(
    private readonly dispatcher: DispatcherService,
    private readonly access: CrmAccessService,
    config: ConfigService<Env, true>,
  ) {
    this.webhookSecret = config.get('CRM_WEBHOOK_SECRET', { infer: true });
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Signed in, no dealership needed: the dealerships whose CRM the caller can open (often none). */
  @Get('dealerships')
  @ApiOperation({ summary: 'Dealerships whose CRM the caller can open' })
  dealerships(@CurrentUser() user: AuthUser) {
    return this.access.dealerships(user);
  }

  @Public()
  @Get('t/o/:file')
  @ApiExcludeEndpoint()
  async open(@Param('file') file: string, @Res() response: Response) {
    const token = file.replace(/\.gif$/, '');
    if (TOKEN.test(token)) await this.dispatcher.recordOpen(token).catch(() => undefined);
    response
      .set({
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, max-age=0',
        'Content-Length': String(PIXEL.length),
      })
      .status(200)
      .end(PIXEL);
  }

  @Public()
  @Get('t/c/:token')
  @ApiExcludeEndpoint()
  async click(
    @Param('token') token: string,
    @Query(zodQuery(clickQuerySchema)) query: z.infer<typeof clickQuerySchema>,
    @Res() response: Response,
  ) {
    const target = TOKEN.test(token)
      ? await this.dispatcher.recordClick(token, query.u, query.s).catch(() => null)
      : null;
    // A forged or altered link goes to the home page, never to the URL it names.
    response.redirect(HttpStatus.FOUND, target ?? this.appUrl);
  }

  @Public()
  @Get('public/unsubscribe/:token')
  @ApiOperation({ summary: 'What an unsubscribe link refers to (dealer name, masked address)' })
  async unsubscribeInfo(@Param('token') token: string) {
    const info = TOKEN.test(token) ? await this.dispatcher.unsubscribeInfo(token) : null;
    if (!info) throw new NotFoundException('This link is not valid');
    return info;
  }

  @Public()
  @Post('public/unsubscribe/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unsubscribe from the dealership’s marketing email (also RFC 8058 one-click)',
  })
  async unsubscribe(@Param('token') token: string) {
    const result = TOKEN.test(token) ? await this.dispatcher.unsubscribe(token) : { ok: false };
    if (!result.ok) throw new NotFoundException('This link is not valid');
    return result;
  }

  @Public()
  @Post('webhooks/email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delivery events from an email provider (shared secret in X-CRM-Webhook-Secret)',
  })
  async webhook(
    @Headers('x-crm-webhook-secret') secret: string | undefined,
    @Body(zodBody(webhookSchema)) event: z.infer<typeof webhookSchema>,
  ) {
    if (!this.webhookSecret) throw new NotFoundException();
    const given = Buffer.from(secret ?? '');
    const expected = Buffer.from(this.webhookSecret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Bad webhook secret');
    }
    const matched = await this.dispatcher.providerEvent(event);
    return { matched };
  }
}
