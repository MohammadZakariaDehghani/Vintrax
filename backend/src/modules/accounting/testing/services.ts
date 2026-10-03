import { PrismaService } from '../../../common/prisma/prisma.service';
import { PostingService } from '../journal/posting.service';
import { JournalService } from '../journal/journal.service';
import { TaxService } from '../tax/tax.service';
import { AcquisitionsService } from '../inventory/acquisitions.service';
import { TradeInsService } from '../inventory/trade-ins.service';
import { SalesService } from '../sales/sales.service';
import { DepositsService } from '../sales/deposits.service';
import { InvoicesService } from '../receivables/invoices.service';
import { BillsService } from '../payables/bills.service';
import { PaymentsService } from '../payments/payments.service';
import { ExpensesService } from '../expenses/expenses.service';
import { BankingService } from '../banking/banking.service';
import { FloorPlanService } from '../floor-plan/floor-plan.service';
import { PartiesService } from '../parties/parties.service';
import { PeriodsService } from '../periods/periods.service';
import { AccountsService } from '../accounts/accounts.service';
import { AccountingSettingsService } from '../settings/settings.service';

/** Every accounting service wired by hand, for database tests. */
export function accountingServices(prisma: PrismaService) {
  const posting = new PostingService();
  const tax = new TaxService(prisma);
  return {
    posting,
    tax,
    journal: new JournalService(prisma, posting),
    acquisitions: new AcquisitionsService(prisma, posting, tax),
    tradeIns: new TradeInsService(prisma),
    sales: new SalesService(prisma, posting, tax),
    deposits: new DepositsService(prisma, posting),
    invoices: new InvoicesService(prisma, posting, tax),
    bills: new BillsService(prisma, posting, tax),
    payments: new PaymentsService(prisma, posting),
    expenses: new ExpensesService(prisma, posting, tax),
    banking: new BankingService(prisma, posting),
    floorPlan: new FloorPlanService(prisma, posting),
    parties: new PartiesService(prisma),
    periods: new PeriodsService(prisma, posting),
    accounts: new AccountsService(prisma),
    settings: new AccountingSettingsService(prisma, posting),
  };
}
