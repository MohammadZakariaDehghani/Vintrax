import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  accountingSettingsSchema,
  accountingSetupSchema,
  staffMemberSchema,
  staffRoleSchema,
  type AccountingSettingsInput,
  type AccountingSetupInput,
  type DealerStaffRole,
  type StaffMemberInput,
} from '@vintrax/shared';
import { CurrentUser } from '../../../common/decorators';
import type { AuthUser } from '../../../common/auth/auth-user';
import { zodBody } from '../../../common/pipes/zod-validation.pipe';
import { AccountingGuard } from '../core/accounting.guard';
import { Acct, AccountingSetupRoute, RequireAccounting, type AccountingContext } from '../core/context';
import { AccountingSettingsService } from '../settings/settings.service';

/**
 * Accounting setup, settings and the dealership's team.
 *
 * Every route under `dealer/accounting` runs behind `AccountingGuard`, which
 * works out the dealership and role from the session (an `x-dealer-id`
 * header only picks between dealerships the caller already belongs to).
 */
@ApiTags('accounting')
@Controller('dealer/accounting')
export class AccountingSetupController {
  constructor(private readonly settings: AccountingSettingsService) {}

  @Get('dealerships')
  @ApiOperation({ summary: 'Dealerships whose books the caller can open, with their role' })
  dealerships(@CurrentUser() user: AuthUser) {
    return this.settings.myDealerships(user);
  }

  @Get('status')
  @UseGuards(AccountingGuard)
  @AccountingSetupRoute()
  @ApiOperation({ summary: 'Whether accounting is set up, and the caller’s role and permissions' })
  status(@Acct() ctx: AccountingContext) {
    return this.settings.status(ctx);
  }

  @Post('setup')
  @UseGuards(AccountingGuard)
  @AccountingSetupRoute()
  @RequireAccounting('accounting.settings')
  @ApiOperation({ summary: 'Set up accounting: settings, chart of accounts, fiscal year, bank' })
  setup(@Acct() ctx: AccountingContext, @Body(zodBody(accountingSetupSchema)) input: AccountingSetupInput) {
    return this.settings.setup(ctx, input);
  }

  @Get('settings')
  @UseGuards(AccountingGuard)
  @RequireAccounting('accounting.view')
  getSettings(@Acct() ctx: AccountingContext) {
    return this.settings.settings(ctx);
  }

  @Patch('settings')
  @UseGuards(AccountingGuard)
  @RequireAccounting('accounting.settings')
  updateSettings(@Acct() ctx: AccountingContext, @Body(zodBody(accountingSettingsSchema)) input: AccountingSettingsInput) {
    return this.settings.updateSettings(ctx, input);
  }

  @Get('team')
  @UseGuards(AccountingGuard)
  @RequireAccounting('accounting.manage_team')
  team(@Acct() ctx: AccountingContext) {
    return this.settings.team(ctx);
  }

  @Post('team')
  @UseGuards(AccountingGuard)
  @RequireAccounting('accounting.manage_team')
  @ApiOperation({ summary: 'Give an existing Vintrax account a role in this dealership' })
  addMember(@Acct() ctx: AccountingContext, @Body(zodBody(staffMemberSchema)) input: StaffMemberInput) {
    return this.settings.addMember(ctx, input);
  }

  @Patch('team/:memberId')
  @UseGuards(AccountingGuard)
  @RequireAccounting('accounting.manage_team')
  changeRole(
    @Acct() ctx: AccountingContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(zodBody(staffRoleSchema)) input: { role: DealerStaffRole },
  ) {
    return this.settings.changeMemberRole(ctx, memberId, input.role);
  }

  @Delete('team/:memberId')
  @UseGuards(AccountingGuard)
  @RequireAccounting('accounting.manage_team')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(@Acct() ctx: AccountingContext, @Param('memberId', ParseUUIDPipe) memberId: string) {
    await this.settings.removeMember(ctx, memberId);
  }
}
