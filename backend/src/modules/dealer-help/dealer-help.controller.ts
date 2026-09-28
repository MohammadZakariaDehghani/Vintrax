import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { helpChatSchema, type HelpChatInput, type HelpChatReply } from '@vintrax/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DealerHelpService } from './dealer-help.service';

/**
 * The dealer portal's help assistant.
 *
 * Signed-in sellers and dealers only — the global guard rejects anonymous
 * callers, and `vehicle:write` is the same gate as the rest of the portal.
 * Throttled per caller, since each question may cost a model call.
 */
@ApiTags('dealer-help')
@Controller('dealer/help')
export class DealerHelpController {
  constructor(private readonly help: DealerHelpService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('vehicle:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask the dealer help assistant how to use the portal' })
  chat(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(helpChatSchema)) input: HelpChatInput,
  ): Promise<HelpChatReply> {
    return this.help.chat(user, input);
  }
}
