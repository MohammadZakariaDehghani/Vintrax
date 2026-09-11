import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type VehicleSummary, type Paginated, paginationSchema } from '@vintrax/shared';
import { CurrentUser } from '../../common/decorators';
import { zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { FavouritesService } from './favourites.service';

@ApiTags('favourites')
@Controller()
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Get('me/favourites')
  @ApiOperation({ summary: "Return the caller's favourited vehicles" })
  list(
    @Query(zodQuery(paginationSchema)) query: { page: number; pageSize: number },
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<VehicleSummary>> {
    return this.favourites.list(user, query.page, query.pageSize);
  }

  // PUT rather than POST: favouriting is idempotent, so repeat calls are safe.
  @Put('vehicles/:id/favourite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Favourite a vehicle' })
  async add(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.favourites.add(id, user);
  }

  @Delete('vehicles/:id/favourite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a vehicle from favourites' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.favourites.remove(id, user);
  }
}
