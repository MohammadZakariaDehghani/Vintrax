import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adminReviewListQuerySchema,
  reviewBulkSchema,
  reviewModerationNoteSchema,
  reviewRejectSchema,
  type AdminReviewDetail,
  type AdminReviewListQuery,
  type AdminReviewRow,
  type Paginated,
  type ReviewBulkInput,
  type ReviewBulkResult,
  type ReviewHistoryEntry,
  type ReviewMetrics,
  type ReviewModerationNoteInput,
  type ReviewRejectInput,
} from '@vintrax/shared';
import { hasPermission, type AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { ReviewsAdminService } from './reviews-admin.service';

/**
 * Review moderation. Reading needs `review:read`, changing a review's state
 * `review:moderate`, and deleting `review:delete`. The status a review moves
 * to is decided here from the action, never taken from the request.
 */
@ApiTags('admin-reviews')
@Controller('admin/reviews')
export class ReviewsAdminController {
  constructor(private readonly reviews: ReviewsAdminService) {}

  @Get()
  @RequirePermissions('review:read')
  @ApiOperation({ summary: 'Reviews by view (pending, approved, reported …), searchable' })
  list(
    @Query(zodQuery(adminReviewListQuerySchema)) query: AdminReviewListQuery,
  ): Promise<Paginated<AdminReviewRow>> {
    return this.reviews.list(query);
  }

  @Get('metrics')
  @RequirePermissions('review:read')
  @ApiOperation({ summary: 'Review counts and average rating for the dashboard' })
  metrics(): Promise<ReviewMetrics> {
    return this.reviews.metrics();
  }

  @Post('bulk')
  @RequirePermissions('review:moderate')
  @ApiOperation({ summary: 'Approve, reject, hide or delete several reviews' })
  bulk(
    @Body(zodBody(reviewBulkSchema)) input: ReviewBulkInput,
    @CurrentUser() admin: AuthUser,
  ): Promise<ReviewBulkResult> {
    // Deleting is its own permission, in bulk as one at a time.
    if (input.action === 'DELETE' && !hasPermission(admin.role, 'review:delete')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.reviews.bulk(input, admin);
  }

  @Get(':id')
  @RequirePermissions('review:read')
  @ApiOperation({ summary: 'One review with its author, reports and moderation fields' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminReviewDetail> {
    return this.reviews.get(id);
  }

  @Get(':id/history')
  @RequirePermissions('review:read')
  @ApiOperation({ summary: 'The review’s moderation history' })
  history(@Param('id', ParseUUIDPipe) id: string): Promise<ReviewHistoryEntry[]> {
    return this.reviews.history(id);
  }

  @Post(':id/approve')
  @RequirePermissions('review:moderate')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reviewModerationNoteSchema)) input: ReviewModerationNoteInput,
    @CurrentUser() admin: AuthUser,
  ): Promise<AdminReviewDetail> {
    return this.reviews.approve(id, admin, input.note);
  }

  @Post(':id/reject')
  @RequirePermissions('review:moderate')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reviewRejectSchema)) input: ReviewRejectInput,
    @CurrentUser() admin: AuthUser,
  ): Promise<AdminReviewDetail> {
    return this.reviews.reject(id, admin, input);
  }

  @Post(':id/hide')
  @RequirePermissions('review:moderate')
  hide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reviewModerationNoteSchema)) input: ReviewModerationNoteInput,
    @CurrentUser() admin: AuthUser,
  ): Promise<AdminReviewDetail> {
    return this.reviews.hide(id, admin, input.note);
  }

  @Post(':id/restore')
  @RequirePermissions('review:moderate')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reviewModerationNoteSchema)) input: ReviewModerationNoteInput,
    @CurrentUser() admin: AuthUser,
  ): Promise<AdminReviewDetail> {
    return this.reviews.restore(id, admin, input.note);
  }

  @Post(':id/resolve-reports')
  @RequirePermissions('review:moderate')
  @ApiOperation({ summary: 'Mark the review’s open reports as reviewed' })
  resolveReports(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reviewModerationNoteSchema)) input: ReviewModerationNoteInput,
    @CurrentUser() admin: AuthUser,
  ): Promise<AdminReviewDetail> {
    return this.reviews.resolveReports(id, admin, input.note);
  }

  @Delete(':id')
  @RequirePermissions('review:delete')
  @ApiOperation({ summary: 'Delete a review (soft: it and its history are kept)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reviewModerationNoteSchema)) input: ReviewModerationNoteInput,
    @CurrentUser() admin: AuthUser,
  ): Promise<AdminReviewDetail> {
    return this.reviews.remove(id, admin, input.note);
  }
}
