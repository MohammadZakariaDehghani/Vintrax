import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  reviewCreateSchema,
  reviewListQuerySchema,
  reviewReportSchema,
  reviewUpdateSchema,
  type MyReview,
  type PublicReviewPage,
  type ReviewCreateInput,
  type ReviewListQuery,
  type ReviewReportInput,
  type ReviewSubmitted,
  type ReviewUpdateInput,
} from '@vintrax/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClientIp, CurrentUser, Public } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

/**
 * Reviews on a vehicle page. Reading and writing are open to everyone,
 * signed in or not; editing and withdrawing are the author's own. The vehicle
 * comes from the URL and the author from the session — never from the body.
 */
@ApiTags('reviews')
@Controller('vehicles/:vehicleId/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Approved reviews, a page at a time; the first page carries the rating summary' })
  list(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Query(zodQuery(reviewListQuerySchema)) query: ReviewListQuery,
  ): Promise<PublicReviewPage> {
    return this.reviews.list(vehicleId, query);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Your own review of this vehicle, in any state, or null' })
  mine(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<MyReview | null> {
    return this.reviews.mine(vehicleId, user);
  }

  @Public()
  @Post()
  // A burst limit on top of the per-address hourly and pending limits in the service.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit a review (anonymous or signed in); it waits for moderation' })
  create(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body(zodBody(reviewCreateSchema)) input: ReviewCreateInput,
    @ClientIp() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @CurrentUser() user?: AuthUser,
  ): Promise<ReviewSubmitted> {
    return this.reviews.create(vehicleId, input, { user, ip, userAgent: userAgent ?? null });
  }

  @Patch(':reviewId')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Edit your review; it goes back to moderation' })
  update(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body(zodBody(reviewUpdateSchema)) input: ReviewUpdateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ReviewSubmitted> {
    return this.reviews.update(vehicleId, reviewId, input, user);
  }

  @Delete(':reviewId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw your review' })
  async remove(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.reviews.remove(vehicleId, reviewId, user);
  }

  @Public()
  @Post(':reviewId/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Report a review; it stays up until an administrator looks at it' })
  report(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body(zodBody(reviewReportSchema)) input: ReviewReportInput,
    @ClientIp() ip: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<{ message: string }> {
    return this.reviews.report(vehicleId, reviewId, input, { user, ip });
  }
}
