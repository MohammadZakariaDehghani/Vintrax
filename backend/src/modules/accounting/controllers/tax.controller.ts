import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PROVINCES,
  TAX_DISCLAIMER,
  dateInput,
  reportQuerySchema,
  taxFilingCreateSchema,
  taxFilingUpdateSchema,
  taxQuoteSchema,
  taxRuleCreateSchema,
  taxRuleStatusSchema,
  taxRuleSupersedeSchema,
  type ReportQuery,
  type TaxFilingCreateInput,
  type TaxFilingUpdateInput,
  type TaxQuoteInput,
  type TaxRuleCreateInput,
  type TaxRuleSupersedeInput,
} from '@vintrax/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../../common/decorators';
import type { AuthUser } from '../../../common/auth/auth-user';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { AccountingGuard } from '../core/accounting.guard';
import { Acct, RequireAccounting, type AccountingContext } from '../core/context';
import { resolveRange } from '../reports/date-ranges';
import { TaxService } from '../tax/tax.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const provinceQuerySchema = z.object({ province: z.enum(PROVINCES).optional() });
const generateFilingsSchema = z.object({ fiscalYearStart: dateInput });

/** The dealer's tax rules, the tax calculator and the Tax Center. */
@ApiTags('accounting')
@Controller('dealer/accounting/tax')
@UseGuards(AccountingGuard)
export class TaxController {
  constructor(
    private readonly tax: TaxService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('rules')
  @RequireAccounting('accounting.view')
  @ApiOperation({ summary: 'Tax rules in effect for the dealer (platform defaults and overrides, with history)' })
  async rules(@Acct() ctx: AccountingContext, @Query(zodQuery(provinceQuerySchema)) query: { province?: (typeof PROVINCES)[number] }) {
    return { disclaimer: TAX_DISCLAIMER, rules: await this.tax.listRules(ctx, query.province) };
  }

  @Post('rules')
  @RequireAccounting('accounting.manage_tax')
  @ApiOperation({ summary: 'Add a dealer-specific rule (overrides the platform rule of that tax type)' })
  createRule(@Acct() ctx: AccountingContext, @Body(zodBody(taxRuleCreateSchema)) input: TaxRuleCreateInput) {
    return this.tax.createDealerRule(ctx, input);
  }

  @Post('rules/:ruleId/supersede')
  @RequireAccounting('accounting.manage_tax')
  @ApiOperation({ summary: 'A new rate from a date; the old version stays for earlier transactions' })
  supersedeRule(
    @Acct() ctx: AccountingContext,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body(zodBody(taxRuleSupersedeSchema)) input: TaxRuleSupersedeInput,
  ) {
    return this.tax.supersedeRule(ctx, ruleId, input);
  }

  @Patch('rules/:ruleId')
  @RequireAccounting('accounting.manage_tax')
  setRuleActive(
    @Acct() ctx: AccountingContext,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body(zodBody(taxRuleStatusSchema)) input: { isActive: boolean },
  ) {
    return this.tax.setRuleActive(ctx, ruleId, input.isActive);
  }

  @Post('quote')
  @RequireAccounting('accounting.sales')
  @ApiOperation({ summary: 'Calculate tax for a set of lines without recording anything' })
  quote(@Acct() ctx: AccountingContext, @Body(zodBody(taxQuoteSchema)) input: TaxQuoteInput) {
    return this.tax.quote(ctx, input);
  }

  @Get('summary')
  @RequireAccounting('accounting.view')
  @ApiOperation({ summary: 'Tax collected, paid, recoverable and net payable by return, for a range' })
  async summary(@Acct() ctx: AccountingContext, @Query(zodQuery(reportQuerySchema)) query: ReportQuery) {
    const range = await resolveRange(this.prisma, ctx.dealerId, query, 'THIS_QUARTER');
    return { range, disclaimer: TAX_DISCLAIMER, returns: await this.tax.summary(ctx, range.from, range.to) };
  }

  @Get('filings')
  @RequireAccounting('accounting.view')
  filings(@Acct() ctx: AccountingContext) {
    return this.tax.listFilings(ctx);
  }

  @Post('filings')
  @RequireAccounting('accounting.manage_tax')
  createFiling(@Acct() ctx: AccountingContext, @Body(zodBody(taxFilingCreateSchema)) input: TaxFilingCreateInput) {
    return this.tax.createFiling(ctx, input);
  }

  @Post('filings/generate')
  @RequireAccounting('accounting.manage_tax')
  @ApiOperation({ summary: 'Create the filing periods of a fiscal year at the dealer’s filing frequency' })
  generateFilings(@Acct() ctx: AccountingContext, @Body(zodBody(generateFilingsSchema)) input: { fiscalYearStart: string }) {
    return this.tax.generateFilings(ctx, input.fiscalYearStart);
  }

  @Patch('filings/:filingId')
  @RequireAccounting('accounting.manage_tax')
  @ApiOperation({ summary: 'Move a filing through Open → In review → Filed → Closed, record adjustments' })
  updateFiling(
    @Acct() ctx: AccountingContext,
    @Param('filingId', ParseUUIDPipe) filingId: string,
    @Body(zodBody(taxFilingUpdateSchema)) input: TaxFilingUpdateInput,
  ) {
    return this.tax.updateFiling(ctx, filingId, input);
  }
}

/**
 * The platform's default tax rules. Platform administrators maintain them
 * (a rate change is a new version from its effective date); they cannot see
 * any dealer's books through this.
 */
@ApiTags('accounting-admin')
@Controller('admin/accounting/tax-rules')
export class PlatformTaxRulesController {
  constructor(private readonly tax: TaxService) {}

  @Get()
  @RequirePermissions('settings:manage')
  async list() {
    return { disclaimer: TAX_DISCLAIMER, rules: await this.tax.listPlatformRules() };
  }

  @Post()
  @RequirePermissions('settings:manage')
  create(@CurrentUser() user: AuthUser, @Body(zodBody(taxRuleCreateSchema)) input: TaxRuleCreateInput) {
    return this.tax.createPlatformRule(user.id, input);
  }

  @Post(':ruleId/supersede')
  @RequirePermissions('settings:manage')
  supersede(
    @CurrentUser() user: AuthUser,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body(zodBody(taxRuleSupersedeSchema)) input: TaxRuleSupersedeInput,
  ) {
    return this.tax.supersedePlatformRule(user.id, ruleId, input);
  }
}
