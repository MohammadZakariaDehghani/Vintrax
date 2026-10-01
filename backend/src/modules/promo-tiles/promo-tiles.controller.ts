import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type PromoTile,
  type ReorderPromoTilesInput,
  type SavePromoTileInput,
  reorderPromoTilesSchema,
  savePromoTileSchema,
} from '@vintrax/shared';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { PromoTilesService } from './promo-tiles.service';

@ApiTags('promo-tiles')
@Controller()
export class PromoTilesController {
  constructor(
    private readonly tiles: PromoTilesService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('promo-tiles')
  @ApiOperation({ summary: 'The promo tiles the home page shows, in slot order' })
  published(): Promise<PromoTile[]> {
    return this.tiles.published();
  }

  @Get('admin/promo-tiles')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Every home box, empty and hidden ones included — at least three',
  })
  all(): Promise<PromoTile[]> {
    return this.tiles.all();
  }

  // Declared before `:slot` so `order` is not read as a slot number.
  @Put('admin/promo-tiles/order')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Put the saved home boxes in a new order, by their current slots' })
  async reorder(
    @Body(zodBody(reorderPromoTilesSchema)) input: ReorderPromoTilesInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PromoTile[]> {
    const tiles = await this.tiles.reorder(input);
    await this.record(user, 'content.promo-tile.reordered', { slots: input.slots });
    return tiles;
  }

  @Delete('admin/promo-tiles/:slot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Delete a home box; the boxes after it move up a place' })
  async remove(
    @Param('slot', ParseIntPipe) slot: number,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.tiles.remove(slot);
    await this.record(user, 'content.promo-tile.deleted', { slot });
  }

  @Put('admin/promo-tiles/:slot')
  @RequirePermissions('content:manage')
  @ApiOperation({
    summary: 'Save one promo tile whole',
    description: 'imageUrl must be a URL returned by POST /uploads/promo-tiles.',
  })
  async save(
    @Param('slot', ParseIntPipe) slot: number,
    @Body(zodBody(savePromoTileSchema)) input: SavePromoTileInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PromoTile> {
    const tile = await this.tiles.save(slot, input, user.id);
    await this.record(user, 'content.promo-tile.saved', { slot });
    return tile;
  }

  private record(user: AuthUser, action: string, metadata: Record<string, unknown>) {
    return this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action,
      entityType: 'PromoTile',
      // Audit ids are UUIDs; a tile is known by its slot.
      entityId: null,
      metadata,
    });
  }
}
