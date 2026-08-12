import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ConfirmPaymentInput,
  type CreateOrderInput,
  type Paginated,
  type TransactionSummary,
  confirmPaymentSchema,
  createOrderSchema,
} from '@atlas/shared';
import { z } from 'zod';
import { Audit, CurrentUser, RequireVerifiedEmail } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { TransactionsService } from './transactions.service';

const listQuerySchema = z.object({
  role: z.enum(['buyer', 'seller']).default('buyer'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
});

@ApiTags('orders')
@Controller('orders')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: "Return the caller's orders, as buyer or seller" })
  list(
    @Query(zodQuery(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<TransactionSummary>> {
    return this.transactions.listMine(user, query.role, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Return an order' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TransactionSummary> {
    return this.transactions.findById(id, user);
  }

  @Post()
  @RequireVerifiedEmail()
  @Audit('transaction.created', 'TransactionRecord')
  @ApiOperation({
    summary: 'Create an order',
    description:
      'Used for a fixed-price purchase, or by the winning bidder to settle an ended auction.',
  })
  create(
    @Body(zodBody(createOrderSchema)) body: CreateOrderInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TransactionSummary> {
    return this.transactions.createOrder(body, user);
  }

  @Post(':id/payment')
  @Audit('payment.confirmed', 'TransactionRecord')
  @ApiOperation({
    summary: 'Record a successful payment',
    description:
      'The provider reference is unique, so a retried provider callback cannot mark a payment paid twice.',
  })
  confirmPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(confirmPaymentSchema)) body: ConfirmPaymentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TransactionSummary> {
    return this.transactions.confirmPayment(id, body, user);
  }

  @Post(':id/complete')
  @Audit('transaction.completed', 'TransactionRecord')
  @ApiOperation({ summary: 'Mark an order delivered and complete' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TransactionSummary> {
    return this.transactions.complete(id, user);
  }

  @Post(':id/cancel')
  @Audit('transaction.cancelled', 'TransactionRecord')
  @ApiOperation({ summary: 'Cancel an unpaid order' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TransactionSummary> {
    return this.transactions.cancel(id, user);
  }
}
