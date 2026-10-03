import { Module } from '@nestjs/common';
import { UploadLimitsModule } from '../../common/upload-limits';
import { AccountsService } from './accounts/accounts.service';
import { AttachmentsService } from './attachments/attachments.service';
import { BankingService } from './banking/banking.service';
import { AccountingSetupController } from './controllers/setup.controller';
import { DealsController } from './controllers/deals.controller';
import { LedgerController } from './controllers/ledger.controller';
import { MoneyController } from './controllers/money.controller';
import { ReportsController } from './controllers/reports.controller';
import { PlatformTaxRulesController, TaxController } from './controllers/tax.controller';
import { AccountingGuard } from './core/accounting.guard';
import { AccountingAccessService } from './core/access.service';
import { ExpensesService } from './expenses/expenses.service';
import { ExportService } from './export/export.service';
import { FloorPlanService } from './floor-plan/floor-plan.service';
import { AccountingHealthService } from './health/health.service';
import { AcquisitionsService } from './inventory/acquisitions.service';
import { TradeInsService } from './inventory/trade-ins.service';
import { JournalService } from './journal/journal.service';
import { PostingService } from './journal/posting.service';
import { PartiesService } from './parties/parties.service';
import { BillsService } from './payables/bills.service';
import { PaymentsService } from './payments/payments.service';
import { PeriodsService } from './periods/periods.service';
import { InvoicesService } from './receivables/invoices.service';
import { OperationsReportsService } from './reports/operations.service';
import { StatementsService } from './reports/statements.service';
import { DepositsService } from './sales/deposits.service';
import { SalesService } from './sales/sales.service';
import { AccountingSearchService } from './search/search.service';
import { AccountingSettingsService } from './settings/settings.service';
import { TaxService } from './tax/tax.service';

/**
 * Dealer accounting (D-065): a domain module inside the Vintrax monolith, on
 * the same database, users, dealers and vehicles. Nothing here is a separate
 * service; the ledger is the single source for every financial figure.
 */
@Module({
  imports: [UploadLimitsModule],
  controllers: [
    AccountingSetupController,
    LedgerController,
    TaxController,
    PlatformTaxRulesController,
    DealsController,
    MoneyController,
    ReportsController,
  ],
  providers: [
    AccountingAccessService,
    AccountingGuard,
    PostingService,
    TaxService,
    AccountsService,
    JournalService,
    PeriodsService,
    PartiesService,
    AcquisitionsService,
    TradeInsService,
    DepositsService,
    SalesService,
    InvoicesService,
    BillsService,
    PaymentsService,
    ExpensesService,
    BankingService,
    FloorPlanService,
    StatementsService,
    OperationsReportsService,
    ExportService,
    AccountingHealthService,
    AccountingSearchService,
    AttachmentsService,
    AccountingSettingsService,
  ],
})
export class AccountingModule {}
