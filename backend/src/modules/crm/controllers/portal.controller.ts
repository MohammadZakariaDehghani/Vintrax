import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { portalReplySchema, portalTicketSchema, type PortalTicketInput } from '@vintrax/shared';
import type { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser } from '../../../common/decorators';
import { zodBody } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CrmScheduler } from '../automation/scheduler.service';
import { CrmSetupService } from '../core/setup.service';
import { TicketsService } from '../support/tickets.service';

/**
 * Support for every signed-in user and dealer: their own tickets and the
 * public conversation on them. Internal notes, assignees and the event log
 * are never part of these responses.
 */
@ApiTags('support')
@Controller('support')
export class SupportPortalController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly prisma: PrismaService,
    private readonly setup: CrmSetupService,
    private readonly scheduler: CrmScheduler,
  ) {}

  @Get('categories')
  async categories() {
    await this.setup.ensureSupport();
    return this.prisma.supportCategory.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, label: true },
    });
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Your support tickets' })
  list(@CurrentUser() user: AuthUser) {
    return this.tickets.listMine(user);
  }

  @Post('tickets')
  @ApiOperation({ summary: 'Ask Vintrax support for help' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(portalTicketSchema)) input: PortalTicketInput,
  ) {
    const ticket = await this.tickets.createFromPortal(user, input);
    this.scheduler.kick();
    return ticket;
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'One of your tickets and its public conversation' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.getMine(user, id);
  }

  @Post('tickets/:id/replies')
  @ApiOperation({ summary: 'Reply on your ticket (reopens it if it was resolved)' })
  async reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(portalReplySchema)) input: { body: string },
  ) {
    const result = await this.tickets.replyAsRequester(user, id, input.body);
    this.scheduler.kick();
    return result;
  }
}
