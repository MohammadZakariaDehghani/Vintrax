import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AuctionDetail,
  type AuctionSummary,
  type BidSummary,
  type CreateAuctionInput,
  type Paginated,
  type PlaceBidInput,
  type SearchAuctionsQuery,
  type UpdateAuctionInput,
  createAuctionSchema,
  paginationSchema,
  placeBidSchema,
  searchAuctionsSchema,
  updateAuctionSchema,
} from '@vintrax/shared';
import {
  Audit,
  ClientIp,
  CurrentUser,
  Public,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuctionsService } from './auctions.service';

@ApiTags('auctions')
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search auctions' })
  search(
    @Query(zodQuery(searchAuctionsSchema)) query: SearchAuctionsQuery,
    @CurrentUser() user?: AuthUser,
  ): Promise<Paginated<AuctionSummary>> {
    return this.auctions.search(query, user);
  }

  // Declared before ':id' so the literal segment is not captured as a UUID.
  @Get('my-bids')
  @ApiOperation({ summary: "Return the caller's bid history" })
  myBids(
    @Query(zodQuery(paginationSchema)) query: { page: number; pageSize: number },
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<BidSummary>> {
    return this.auctions.listMyBids(user, query.page, query.pageSize);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Return an auction with its recent bid history' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<AuctionDetail> {
    return this.auctions.findById(id, user);
  }

  @Public()
  @Get(':id/bids')
  @ApiOperation({ summary: 'Return an auction bid history' })
  listBids(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodQuery(paginationSchema)) query: { page: number; pageSize: number },
    @CurrentUser() user?: AuthUser,
  ): Promise<Paginated<BidSummary>> {
    return this.auctions.listBids(id, query.page, query.pageSize, user);
  }

  @Post()
  @RequirePermissions('auction:create')
  @RequireVerifiedEmail()
  @Audit('auction.created', 'Auction')
  @ApiOperation({ summary: 'Schedule an auction for a vehicle the caller owns' })
  create(
    @Body(zodBody(createAuctionSchema)) body: CreateAuctionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<AuctionDetail> {
    return this.auctions.create(body, user);
  }

  @Patch(':id')
  @RequirePermissions('auction:create')
  @Audit('auction.updated', 'Auction')
  @ApiOperation({ summary: 'Update an auction before bidding starts' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateAuctionSchema)) body: UpdateAuctionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<AuctionDetail> {
    return this.auctions.update(id, body, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('auction:create')
  @Audit('auction.cancelled', 'Auction')
  @ApiOperation({ summary: 'Cancel an auction' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AuctionDetail> {
    return this.auctions.cancel(id, user);
  }

  @Post(':id/bids')
  @RequirePermissions('bid:place')
  @RequireVerifiedEmail()
  // Bidding is the hottest write path on the platform, so it gets its own
  // budget: generous enough for a real bidding war, tight enough to stop a bot.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Audit('bid.placed', 'Auction')
  @ApiOperation({
    summary: 'Place a bid',
    description:
      'Runs in a serializable transaction, so simultaneous bids conflict rather than interleave. ' +
      'A bid inside the anti-snipe window extends the auction. Returns 409 when a concurrent bid wins the race.',
  })
  placeBid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(placeBidSchema)) body: PlaceBidInput,
    @CurrentUser() user: AuthUser,
    @ClientIp() ipAddress: string,
  ): Promise<{ bid: BidSummary; auction: AuctionDetail }> {
    return this.auctions.placeBid(id, body, user, ipAddress);
  }
}
