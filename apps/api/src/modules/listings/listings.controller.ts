import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateListingInput,
  type ListingDetail,
  type ListingSearchResponse,
  type ListingSummary,
  type Paginated,
  type UpdateListingInput,
  createListingSchema,
  searchListingsSchema,
  updateListingSchema,
} from '@atlas/shared';
import { z } from 'zod';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ListingsService } from './listings.service';

const myListingsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'SOLD', 'ARCHIVED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
});

@ApiTags('listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Search active listings',
    description:
      'Filters, sorting and pagination follow the searchListingsSchema contract in @atlas/shared. ' +
      'Authenticating is optional; when a token is supplied each result carries its isFavourited flag.',
  })
  search(
    @Query(zodQuery(searchListingsSchema)) query: unknown,
    @CurrentUser() user?: AuthUser,
  ): Promise<ListingSearchResponse> {
    return this.listings.search(query as Parameters<ListingsService['search']>[0], user);
  }

  // Declared before ':id' so the literal segment is not captured as a UUID.
  @Get('mine')
  @Roles('DEALER', 'PRIVATE_SELLER')
  @ApiOperation({ summary: "Return the caller's own listings, including drafts" })
  listMine(
    @Query(zodQuery(myListingsQuerySchema)) query: z.infer<typeof myListingsQuerySchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<ListingSummary>> {
    return this.listings.listMine(user, query.page, query.pageSize, query.status);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Return a single listing' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<ListingDetail> {
    return this.listings.findById(id, user);
  }

  @Post()
  @Roles('DEALER', 'PRIVATE_SELLER')
  @ApiOperation({ summary: 'Publish a new listing' })
  create(
    @Body(zodBody(createListingSchema)) body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ListingDetail> {
    return this.listings.create(body as CreateListingInput, user);
  }

  @Patch(':id')
  @Roles('DEALER', 'PRIVATE_SELLER')
  @ApiOperation({ summary: 'Update a listing the caller owns' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateListingSchema)) body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ListingDetail> {
    return this.listings.update(id, body as UpdateListingInput, user);
  }

  @Delete(':id')
  @Roles('DEALER', 'PRIVATE_SELLER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a listing the caller owns' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.listings.remove(id, user);
  }
}
