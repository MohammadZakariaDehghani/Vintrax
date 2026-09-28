import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  dealerInventoryExportSchema,
  dealerInventoryFilterSchema,
  dealerInventoryQuerySchema,
  type DealerInventoryExportInput,
  type DealerInventoryFilter,
  type DealerInventoryPage,
  type DealerInventoryQuery,
  type DealerInventorySelection,
  type DealerInventoryStats,
} from '@vintrax/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DealerInventoryService } from './dealer-inventory.service';
import { InventoryService } from './inventory.service';

/**
 * The dealer portal's inventory table.
 *
 * Shares `dealer/inventory` with the CSV routes in `InventoryController`, and
 * the same authority: `vehicle:write`, the permission that already lets a
 * seller create and edit their own listings. No route takes an owner id; the
 * owner is the caller.
 *
 * Create, edit, status changes and delete are the existing `/vehicles` routes.
 */
@ApiTags('inventory')
@Controller('dealer/inventory')
export class DealerInventoryController {
  constructor(
    private readonly dealerInventory: DealerInventoryService,
    private readonly inventory: InventoryService,
  ) {}

  @Get()
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: "List the caller's own vehicles with filters, sorting and costs" })
  list(
    @CurrentUser() user: AuthUser,
    @Query(zodQuery(dealerInventoryQuerySchema)) query: DealerInventoryQuery,
  ): Promise<DealerInventoryPage> {
    return this.dealerInventory.list(user, query);
  }

  @Get('stats')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: "Counts and value of the caller's own inventory" })
  stats(@CurrentUser() user: AuthUser): Promise<DealerInventoryStats> {
    return this.dealerInventory.stats(user);
  }

  @Get('selection')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Every id matching a filter, for selecting all of them' })
  selection(
    @CurrentUser() user: AuthUser,
    @Query(zodQuery(dealerInventoryFilterSchema)) filter: DealerInventoryFilter,
  ): Promise<DealerInventorySelection> {
    return this.dealerInventory.selection(user, filter);
  }

  @Post('export')
  @RequirePermissions('vehicle:write')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vintrax-inventory-selection.csv"')
  @ApiOperation({
    summary: 'Export chosen vehicles as CSV',
    description:
      "Ids that are not the caller's are left out, not reported, so the file never confirms another seller's vehicle exists.",
  })
  exportSelected(
    @CurrentUser() user: AuthUser,
    @Body(zodBody(dealerInventoryExportSchema)) body: DealerInventoryExportInput,
  ): Promise<string> {
    return this.inventory.exportInventory(user, body.ids);
  }

  @Post(':id/duplicate')
  @RequirePermissions('vehicle:write')
  @ApiOperation({ summary: 'Copy one of your vehicles into a new draft' })
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    return this.dealerInventory.duplicate(id, user);
  }
}
