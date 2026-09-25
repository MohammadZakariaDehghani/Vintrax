import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type PromoTile, type SavePromoTileInput, savePromoTileSchema } from '@vintrax/shared';
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
  @ApiOperation({ summary: 'All three promo tile slots, empty and hidden ones included' })
  all(): Promise<PromoTile[]> {
    return this.tiles.all();
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
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'content.promo-tile.saved',
      entityType: 'PromoTile',
      // Audit ids are UUIDs; a tile is known by its slot.
      entityId: null,
      metadata: { slot },
    });
    return tile;
  }
}
