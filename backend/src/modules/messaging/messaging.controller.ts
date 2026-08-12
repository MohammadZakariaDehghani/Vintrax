import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ConversationDetail,
  type ConversationSummary,
  type MessageDto,
  type Paginated,
  type StartConversationInput,
  paginationSchema,
  sendMessageSchema,
  startConversationSchema,
} from '@atlas/shared';
import { CurrentUser } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { MessagingService } from './messaging.service';

@ApiTags('messaging')
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @ApiOperation({ summary: "Return the caller's conversations, most recent first" })
  list(
    @Query(zodQuery(paginationSchema)) query: { page: number; pageSize: number },
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<ConversationSummary>> {
    return this.messaging.listConversations(user, query.page, query.pageSize);
  }

  // Declared before ':id' so the literal segment is not captured as a UUID.
  @Get('unread-count')
  @ApiOperation({ summary: 'Return the caller\'s total unread message count' })
  unreadCount(@CurrentUser() user: AuthUser): Promise<{ unread: number }> {
    return this.messaging.unreadTotal(user);
  }

  @Post()
  @ApiOperation({
    summary: 'Start or continue a conversation about a vehicle',
    description:
      'The seller is resolved from the vehicle. Messaging the same vehicle twice continues the existing thread.',
  })
  start(
    @Body(zodBody(startConversationSchema)) body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ConversationDetail> {
    return this.messaging.startConversation(body as StartConversationInput, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Return a thread and mark its incoming messages read' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ConversationDetail> {
    return this.messaging.getConversation(id, user);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Post a reply to a thread' })
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(sendMessageSchema)) body: { body: string },
    @CurrentUser() user: AuthUser,
  ): Promise<MessageDto> {
    return this.messaging.sendMessage(id, body.body, user);
  }
}
