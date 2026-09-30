import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  SUPPORT_CHAT_TOKEN_HEADER,
  adminSupportChatQuerySchema,
  adminSupportReplySchema,
  requestSupportHumanSchema,
  sendSupportMessageSchema,
  startSupportChatSchema,
  updateSupportChatSchema,
  type AdminSupportChatQuery,
  type AdminSupportReplyInput,
  type RequestSupportHumanInput,
  type SendSupportMessageInput,
  type StartSupportChatInput,
  type StartedSupportChat,
  type SupportChatDetail,
  type SupportChatPage,
  type SupportChatView,
  type UpdateSupportChatInput,
} from '@vintrax/shared';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { SupportChatService } from './support-chat.service';

/** The visitor's token, from its header; a missing one is simply "not found". */
function tokenFrom(value: string | undefined): string {
  const token = value?.trim();
  if (!token || token.length > 128) throw new NotFoundException('Chat not found');
  return token;
}

/**
 * The site chat. Visitor routes are public — anyone on the site may ask —
 * and each visitor reaches only their own chat, through its token. The
 * team's routes need `user:manage`, the permission the rest of the admin
 * area's people-facing work uses.
 */
@ApiTags('support-chat')
@Controller()
export class SupportChatController {
  constructor(private readonly chats: SupportChatService) {}

  @Public()
  @Post('support-chat')
  // Starting chats is cheap for a script and costs a model call each.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start a chat with the Vintrax assistant' })
  start(
    @Body(zodBody(startSupportChatSchema)) input: StartSupportChatInput,
    @CurrentUser() viewer?: AuthUser,
  ): Promise<StartedSupportChat> {
    return this.chats.start(input, viewer);
  }

  @Public()
  @Post('support-chat/:id/messages')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a message in your chat' })
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(SUPPORT_CHAT_TOKEN_HEADER) token: string | undefined,
    @Body(zodBody(sendSupportMessageSchema)) input: SendSupportMessageInput,
  ): Promise<SupportChatView> {
    return this.chats.send(id, tokenFrom(token), input);
  }

  @Public()
  @Get('support-chat/:id')
  @ApiOperation({ summary: 'Your chat, with any replies from the team' })
  view(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(SUPPORT_CHAT_TOKEN_HEADER) token: string | undefined,
  ): Promise<SupportChatView> {
    return this.chats.view(id, tokenFrom(token));
  }

  @Public()
  @Post('support-chat/:id/human')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask for a person from the Vintrax team' })
  human(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(SUPPORT_CHAT_TOKEN_HEADER) token: string | undefined,
    @Body(zodBody(requestSupportHumanSchema)) input: RequestSupportHumanInput,
  ): Promise<SupportChatView> {
    return this.chats.requestHuman(id, tokenFrom(token), input);
  }

  @Get('admin/support-chats/unread')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'How many open chats have unread visitor messages' })
  unread(): Promise<{ unread: number }> {
    return this.chats.unreadCount();
  }

  @Get('admin/support-chats')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Site chats, most recent first' })
  list(
    @Query(zodQuery(adminSupportChatQuerySchema)) query: AdminSupportChatQuery,
  ): Promise<SupportChatPage> {
    return this.chats.list(query);
  }

  @Get('admin/support-chats/:id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'One chat and its full history; marks it read' })
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<SupportChatDetail> {
    return this.chats.detail(id);
  }

  @Post('admin/support-chats/:id/messages')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Reply to a visitor as the Vintrax team' })
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(adminSupportReplySchema)) input: AdminSupportReplyInput,
    @CurrentUser() agent: AuthUser,
  ): Promise<SupportChatDetail> {
    return this.chats.reply(id, input.message, agent);
  }

  @Patch('admin/support-chats/:id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Close or reopen a chat' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSupportChatSchema)) input: UpdateSupportChatInput,
  ): Promise<SupportChatDetail> {
    return this.chats.setStatus(id, input.status);
  }
}
