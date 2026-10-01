import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type ArchiveConversationInput,
  type ConversationDetail,
  type ConversationQuery,
  type ConversationSummary,
  type MessageDto,
  type Paginated,
  type StartConversationInput,
  archiveConversationSchema,
  conversationQuerySchema,
  sendMessageSchema,
  startConversationSchema,
} from '@vintrax/shared';
import { CurrentUser } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { MessagingService } from './messaging.service';

@ApiTags('messaging')
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @ApiOperation({
    summary: "Return the caller's conversations, most recent first",
    description:
      "`box`: ALL (not archived), BUYING (cars the caller asked about), SELLING (the caller's own cars) or ARCHIVED. `q` searches the car title and the other person's name.",
  })
  list(
    @Query(zodQuery(conversationQuerySchema)) query: ConversationQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<ConversationSummary>> {
    return this.messaging.listConversations(user, query);
  }

  // Declared before ':id' so the literal segment is not captured as a UUID.
  @Get('unread-count')
  @ApiOperation({ summary: "Return the caller's total unread message count" })
  unreadCount(@CurrentUser() user: AuthUser): Promise<{ unread: number }> {
    return this.messaging.unreadTotal(user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  @Patch(':id/archive')
  @ApiOperation({
    summary: 'Archive a chat, or bring it back, for the caller only',
    description: 'A new message in the chat brings it back automatically.',
  })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(archiveConversationSchema)) body: ArchiveConversationInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ConversationSummary> {
    return this.messaging.setArchived(id, body.archived, user);
  }

  /** Generous for a conversation, tight enough that the inbox cannot be flooded. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
