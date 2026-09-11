import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type DealerAnalytics,
  type DealerDetail,
  type DealerSummary,
  type Paginated,
  type VehicleSummary,
  type VerifyDealerInput,
  verifyDealerSchema,
} from '@vintrax/shared';
import { z } from 'zod';
import { Audit, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DealersService } from './dealers.service';

const listQuerySchema = z.object({
  status: z.string().optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(25),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

@ApiTags('dealers')
@Controller('dealers')
export class DealersController {
  constructor(private readonly dealers: DealersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List dealerships' })
  list(
    @Query(zodQuery(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Paginated<DealerSummary>> {
    return this.dealers.list(query.page, query.pageSize, {
      status: query.status,
      verifiedOnly: query.verifiedOnly,
    });
  }

  // Declared before ':slug' so the literal segment is not captured as a slug.
  @Get('analytics/me')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Dashboard metrics for the calling seller' })
  analytics(@CurrentUser() user: AuthUser): Promise<DealerAnalytics> {
    return this.dealers.analytics(user);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Return a dealership profile' })
  findOne(@Param('slug') slug: string): Promise<DealerDetail> {
    return this.dealers.findBySlug(slug);
  }

  @Public()
  @Get(':slug/inventory')
  @ApiOperation({ summary: "Return a dealership's published inventory" })
  inventory(
    @Param('slug') slug: string,
    @Query(zodQuery(paginationQuerySchema)) query: z.infer<typeof paginationQuerySchema>,
  ): Promise<Paginated<VehicleSummary>> {
    return this.dealers.listInventory(slug, query.page, query.pageSize);
  }

  @Patch(':id/verification')
  @RequirePermissions('dealer:verify')
  @Audit('dealer.verification_decided', 'Dealer')
  @ApiOperation({ summary: 'Approve or reject a dealer verification application' })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(verifyDealerSchema)) body: VerifyDealerInput,
    @CurrentUser() actor: AuthUser,
  ): Promise<DealerDetail> {
    return this.dealers.verify(id, body, actor);
  }
}
