import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type NotificationDto,
  type NotificationPreferencesInput,
  type Paginated,
  notificationPreferencesSchema,
} from '@vintrax/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { NotificationsService } from './notifications.service';

const listQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
});

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "Return the caller's notifications" })
  list(
    @Query(zodQuery(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<NotificationDto>> {
    return this.notifications.list(user.id, query.page, query.pageSize, query.unreadOnly ?? false);
  }

  // Declared before ':id' so the literal segment is not captured as a UUID.
  @Get('unread-count')
  @ApiOperation({ summary: 'Return the unread notification count' })
  unreadCount(@CurrentUser() user: AuthUser): Promise<{ unread: number }> {
    return this.notifications.unreadCount(user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every notification as read' })
  markAllRead(@CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Return the channels notifications reach the caller on' })
  preferences(@CurrentUser() user: AuthUser): Promise<{ channels: string[] }> {
    return this.notifications.channels(user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification channel preferences' })
  updatePreferences(
    @Body(zodBody(notificationPreferencesSchema)) body: NotificationPreferencesInput,
    @CurrentUser() user: AuthUser,
  ): Promise<{ channels: string[] }> {
    return this.notifications.updateChannels(user.id, body.channels);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification as read' })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }
}
