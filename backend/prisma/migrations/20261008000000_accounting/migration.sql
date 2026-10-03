-- Accounting (D-065): a dealer's double-entry books.
--
-- Prisma generates the tables below. The constraints and triggers at the end
-- are hand-written: they are the database's own guarantee of the rules the
-- application also enforces, so a bug in the API cannot post an unbalanced
-- entry, edit a posted one, or rewrite the audit trail.

-- CreateEnum
CREATE TYPE "AcctAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AcctAccountSubtype" AS ENUM ('CASH', 'BANK', 'RECEIVABLE', 'INVENTORY', 'OTHER_CURRENT_ASSET', 'TAX_RECOVERABLE', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'PAYABLE', 'TAX_PAYABLE', 'CUSTOMER_DEPOSIT', 'FLOOR_PLAN', 'CREDIT_CARD', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'EQUITY', 'RETAINED_EARNINGS', 'CURRENT_YEAR_EARNINGS', 'OPERATING_REVENUE', 'OTHER_INCOME', 'COST_OF_SALES', 'OPERATING_EXPENSE', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "DealerStaffRole" AS ENUM ('OWNER', 'MANAGER', 'ACCOUNTANT', 'SALES_MANAGER', 'SALES_USER');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'OPENING_BALANCE', 'VEHICLE_ACQUISITION', 'VEHICLE_COST', 'VEHICLE_SALE', 'CUSTOMER_DEPOSIT', 'DEPOSIT_REFUND', 'CUSTOMER_INVOICE', 'CUSTOMER_PAYMENT', 'CUSTOMER_REFUND', 'VENDOR_BILL', 'VENDOR_CREDIT', 'VENDOR_PAYMENT', 'EXPENSE', 'BANK_TRANSACTION', 'RECONCILIATION_ADJUSTMENT', 'FLOOR_PLAN', 'YEAR_END_CLOSE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "JournalKind" AS ENUM ('STANDARD', 'ADJUSTING', 'OPENING', 'CLOSING', 'REVERSAL');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('GST', 'HST', 'PST', 'QST');

-- CreateEnum
CREATE TYPE "TaxFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "TaxReturnKind" AS ENUM ('GST_HST', 'PST', 'QST');

-- CreateEnum
CREATE TYPE "TaxFilingStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'FILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaxDirection" AS ENUM ('COLLECTED', 'PAID');

-- CreateEnum
CREATE TYPE "VendorKind" AS ENUM ('AUCTION', 'DEALER', 'PRIVATE_SELLER', 'SUPPLIER', 'LENDER', 'SERVICE', 'GOVERNMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AcquisitionMethod" AS ENUM ('AUCTION', 'PRIVATE', 'TRADE_IN', 'DEALER', 'WHOLESALE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'DEBIT', 'CREDIT_CARD', 'E_TRANSFER', 'BANK_TRANSFER', 'FINANCING', 'OTHER');

-- CreateEnum
CREATE TYPE "SettlementMethod" AS ENUM ('PAID', 'ON_ACCOUNT', 'FLOOR_PLAN', 'NONE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('RECEIVED', 'SENT');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "ExpenseTreatment" AS ENUM ('OPERATING', 'VEHICLE_COST', 'COGS', 'CAPITAL');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CHEQUING', 'SAVINGS', 'CASH', 'CREDIT_CARD', 'LINE_OF_CREDIT');

-- CreateEnum
CREATE TYPE "BankTransactionKind" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'FEE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('OPEN', 'PARTIALLY_APPLIED', 'APPLIED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FloorPlanStatus" AS ENUM ('ACTIVE', 'PAID_OFF');

-- CreateEnum
CREATE TYPE "FloorPlanTransactionKind" AS ENUM ('PRINCIPAL_PAYMENT', 'INTEREST_PAYMENT', 'PAYOFF');

-- AlterTable
ALTER TABLE "VehicleCost" ADD COLUMN     "journalEntryId" UUID;

-- CreateTable
CREATE TABLE "DealerMember" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "DealerStaffRole" NOT NULL,
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealerMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSettings" (
    "dealerId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "businessNumber" TEXT,
    "gstHstNumber" TEXT,
    "pstNumber" TEXT,
    "qstNumber" TEXT,
    "province" "Province" NOT NULL,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "fiscalYearStartDay" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "taxFilingFrequency" "TaxFilingFrequency" NOT NULL DEFAULT 'QUARTERLY',
    "defaultBankAccountId" UUID,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV-',
    "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1001,
    "journalPrefix" TEXT NOT NULL DEFAULT 'JE-',
    "nextJournalNumber" INTEGER NOT NULL DEFAULT 1,
    "nextSaleNumber" INTEGER NOT NULL DEFAULT 1,
    "nextBillNumber" INTEGER NOT NULL DEFAULT 1,
    "nextPaymentNumber" INTEGER NOT NULL DEFAULT 1,
    "nextExpenseNumber" INTEGER NOT NULL DEFAULT 1,
    "nextDepositNumber" INTEGER NOT NULL DEFAULT 1,
    "allowNegativeInventory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingSettings_pkey" PRIMARY KEY ("dealerId")
);

-- CreateTable
CREATE TABLE "AcctAccount" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AcctAccountType" NOT NULL,
    "subtype" "AcctAccountSubtype" NOT NULL,
    "systemKey" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentId" UUID,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcctAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "closingEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "fiscalYearId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" UUID,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "memo" TEXT,
    "source" "JournalSource" NOT NULL,
    "kind" "JournalKind" NOT NULL DEFAULT 'STANDARD',
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" TEXT,
    "sourceId" UUID,
    "total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "reversalOfId" UUID,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdById" UUID,
    "postedById" UUID,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "vehicleId" UUID,
    "customerId" UUID,
    "vendorId" UUID,
    "costCategory" "VehicleCostCategory",
    "taxType" "TaxType",
    "reconciliationId" UUID,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" UUID NOT NULL,
    "dealerId" UUID,
    "province" "Province" NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(8,5) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "taxableCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exemptCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minPriceCents" BIGINT,
    "maxPriceCents" BIGINT,
    "tradeInReducesBase" BOOLEAN NOT NULL DEFAULT true,
    "recoverable" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "source" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxLine" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "journalEntryId" UUID,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "taxRuleId" UUID,
    "taxType" "TaxType" NOT NULL,
    "province" "Province" NOT NULL,
    "rate" DECIMAL(8,5) NOT NULL,
    "taxableAmount" DECIMAL(15,2) NOT NULL,
    "exemptAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(15,2) NOT NULL,
    "direction" "TaxDirection" NOT NULL,
    "recoverable" BOOLEAN NOT NULL DEFAULT false,
    "transactionDate" DATE NOT NULL,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxFilingPeriod" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "kind" "TaxReturnKind" NOT NULL,
    "frequency" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "TaxFilingStatus" NOT NULL DEFAULT 'OPEN',
    "adjustments" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "filedAt" TIMESTAMP(3),
    "filedById" UUID,
    "confirmationNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxFilingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" "Province",
    "postalCode" TEXT,
    "userId" UUID,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "VendorKind" NOT NULL DEFAULT 'SUPPLIER',
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "province" "Province",
    "gstNumber" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleAcquisition" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "method" "AcquisitionMethod" NOT NULL,
    "vendorId" UUID,
    "customerId" UUID,
    "date" DATE NOT NULL,
    "purchasePrice" DECIMAL(15,2) NOT NULL,
    "auctionFee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transportation" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "inspection" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "reconditioning" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "otherCosts" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL,
    "settlement" "SettlementMethod" NOT NULL,
    "paymentMethod" "PaymentMethod",
    "bankAccountId" UUID,
    "billId" UUID,
    "floorPlanNoteId" UUID,
    "reference" TEXT,
    "notes" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'POSTED',
    "journalEntryId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleAcquisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeIn" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "saleId" UUID,
    "vin" TEXT,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mileageKm" INTEGER,
    "appraisedValue" DECIMAL(15,2) NOT NULL,
    "tradeAllowance" DECIMAL(15,2) NOT NULL,
    "lienPayoff" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lienHolderVendorId" UUID,
    "netTradeValue" DECIMAL(15,2) NOT NULL,
    "acquisitionId" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleSale" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "vehicleId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "salespersonId" UUID,
    "saleDate" DATE NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "salePrice" DECIMAL(15,2) NOT NULL,
    "discount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "documentationFee" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "dealerFees" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "accessories" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "warranty" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "financeRevenue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "financeLenderVendorId" UUID,
    "tradeInId" UUID,
    "depositApplied" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "downPayment" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "downPaymentMethod" "PaymentMethod",
    "bankAccountId" UUID,
    "financedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxProvince" "Province",
    "taxableAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "costOfSale" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "previousVehicleStatus" "ListingStatus",
    "invoiceId" UUID,
    "journalEntryId" UUID,
    "reversalEntryId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDeposit" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" UUID NOT NULL,
    "vehicleId" UUID,
    "date" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "applied" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "refunded" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "method" "PaymentMethod" NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "reference" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'OPEN',
    "journalEntryId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDepositEvent" (
    "id" UUID NOT NULL,
    "depositId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "date" DATE NOT NULL,
    "saleId" UUID,
    "journalEntryId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDepositEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerInvoice" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "saleId" UUID,
    "date" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "description" TEXT,
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "taxTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL,
    "amountPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'OPEN',
    "journalEntryId" UUID,
    "voidEntryId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BILL',
    "vendorId" UUID NOT NULL,
    "vendorReference" TEXT,
    "date" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "taxTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL,
    "amountPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'OPEN',
    "journalEntryId" UUID,
    "voidEntryId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "customerId" UUID,
    "vendorId" UUID,
    "date" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "bankAccountId" UUID NOT NULL,
    "journalEntryId" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'POSTED',
    "reversalEntryId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID,
    "billId" UUID,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "vendorId" UUID,
    "accountId" UUID NOT NULL,
    "treatment" "ExpenseTreatment" NOT NULL DEFAULT 'OPERATING',
    "vehicleId" UUID,
    "costCategory" "VehicleCostCategory",
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "taxTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL,
    "taxProvince" "Province",
    "method" "PaymentMethod" NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "recurringExpenseId" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'POSTED',
    "journalEntryId" UUID,
    "reversalEntryId" UUID,
    "vehicleCostId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "vendorId" UUID,
    "accountId" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "applyTax" BOOLEAN NOT NULL DEFAULT true,
    "method" "PaymentMethod" NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "nextDate" DATE NOT NULL,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "type" "BankAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "accountNumberLast4" TEXT,
    "glAccountId" UUID NOT NULL,
    "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "openingDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "kind" "BankTransactionKind" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "counterAccountId" UUID,
    "toBankAccountId" UUID,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "journalEntryId" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "statementDate" DATE NOT NULL,
    "beginningBalance" DECIMAL(15,2) NOT NULL,
    "endingBalance" DECIMAL(15,2) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "clearedBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "adjustmentEntryId" UUID,
    "adjustmentReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorPlanNote" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "lenderVendorId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "principal" DECIMAL(15,2) NOT NULL,
    "principalPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "interestPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "interestRate" DECIMAL(8,5) NOT NULL,
    "originationDate" DATE NOT NULL,
    "maturityDate" DATE,
    "status" "FloorPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "journalEntryId" UUID,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorPlanNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorPlanTransaction" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "kind" "FloorPlanTransactionKind" NOT NULL,
    "date" DATE NOT NULL,
    "principal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "bankAccountId" UUID NOT NULL,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FloorPlanTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingAttachment" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReportFilter" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedReportFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingAuditLog" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "actorId" UUID,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealerMember_userId_idx" ON "DealerMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DealerMember_dealerId_userId_key" ON "DealerMember"("dealerId", "userId");

-- CreateIndex
CREATE INDEX "AcctAccount_dealerId_type_idx" ON "AcctAccount"("dealerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AcctAccount_dealerId_code_key" ON "AcctAccount"("dealerId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AcctAccount_dealerId_systemKey_key" ON "AcctAccount"("dealerId", "systemKey");

-- CreateIndex
CREATE INDEX "FiscalYear_dealerId_endDate_idx" ON "FiscalYear"("dealerId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_dealerId_startDate_key" ON "FiscalYear"("dealerId", "startDate");

-- CreateIndex
CREATE INDEX "AccountingPeriod_dealerId_endDate_idx" ON "AccountingPeriod"("dealerId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_dealerId_startDate_key" ON "AccountingPeriod"("dealerId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "JournalEntry_dealerId_date_idx" ON "JournalEntry"("dealerId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_dealerId_status_date_idx" ON "JournalEntry"("dealerId", "status", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_dealerId_sourceType_sourceId_idx" ON "JournalEntry"("dealerId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalEntry_dealerId_reference_idx" ON "JournalEntry"("dealerId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_dealerId_number_key" ON "JournalEntry"("dealerId", "number");

-- CreateIndex
CREATE INDEX "JournalLine_dealerId_accountId_idx" ON "JournalLine"("dealerId", "accountId");

-- CreateIndex
CREATE INDEX "JournalLine_dealerId_vehicleId_idx" ON "JournalLine"("dealerId", "vehicleId");

-- CreateIndex
CREATE INDEX "JournalLine_dealerId_customerId_idx" ON "JournalLine"("dealerId", "customerId");

-- CreateIndex
CREATE INDEX "JournalLine_dealerId_vendorId_idx" ON "JournalLine"("dealerId", "vendorId");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- CreateIndex
CREATE INDEX "JournalLine_reconciliationId_idx" ON "JournalLine"("reconciliationId");

-- CreateIndex
CREATE INDEX "TaxRule_province_taxType_effectiveFrom_idx" ON "TaxRule"("province", "taxType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TaxRule_dealerId_province_idx" ON "TaxRule"("dealerId", "province");

-- CreateIndex
CREATE INDEX "TaxLine_dealerId_transactionDate_idx" ON "TaxLine"("dealerId", "transactionDate");

-- CreateIndex
CREATE INDEX "TaxLine_dealerId_sourceType_sourceId_idx" ON "TaxLine"("dealerId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "TaxFilingPeriod_dealerId_endDate_idx" ON "TaxFilingPeriod"("dealerId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "TaxFilingPeriod_dealerId_kind_startDate_key" ON "TaxFilingPeriod"("dealerId", "kind", "startDate");

-- CreateIndex
CREATE INDEX "Customer_dealerId_name_idx" ON "Customer"("dealerId", "name");

-- CreateIndex
CREATE INDEX "Customer_dealerId_email_idx" ON "Customer"("dealerId", "email");

-- CreateIndex
CREATE INDEX "Vendor_dealerId_name_idx" ON "Vendor"("dealerId", "name");

-- CreateIndex
CREATE INDEX "VehicleAcquisition_dealerId_date_idx" ON "VehicleAcquisition"("dealerId", "date");

-- CreateIndex
CREATE INDEX "VehicleAcquisition_dealerId_vehicleId_idx" ON "VehicleAcquisition"("dealerId", "vehicleId");

-- CreateIndex
CREATE INDEX "TradeIn_dealerId_customerId_idx" ON "TradeIn"("dealerId", "customerId");

-- CreateIndex
CREATE INDEX "TradeIn_dealerId_vehicleId_idx" ON "TradeIn"("dealerId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSale_tradeInId_key" ON "VehicleSale"("tradeInId");

-- CreateIndex
CREATE INDEX "VehicleSale_dealerId_saleDate_idx" ON "VehicleSale"("dealerId", "saleDate");

-- CreateIndex
CREATE INDEX "VehicleSale_dealerId_vehicleId_idx" ON "VehicleSale"("dealerId", "vehicleId");

-- CreateIndex
CREATE INDEX "VehicleSale_dealerId_customerId_idx" ON "VehicleSale"("dealerId", "customerId");

-- CreateIndex
CREATE INDEX "VehicleSale_dealerId_salespersonId_idx" ON "VehicleSale"("dealerId", "salespersonId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSale_dealerId_number_key" ON "VehicleSale"("dealerId", "number");

-- CreateIndex
CREATE INDEX "CustomerDeposit_dealerId_customerId_idx" ON "CustomerDeposit"("dealerId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDeposit_dealerId_number_key" ON "CustomerDeposit"("dealerId", "number");

-- CreateIndex
CREATE INDEX "CustomerDepositEvent_depositId_idx" ON "CustomerDepositEvent"("depositId");

-- CreateIndex
CREATE INDEX "CustomerInvoice_dealerId_customerId_status_idx" ON "CustomerInvoice"("dealerId", "customerId", "status");

-- CreateIndex
CREATE INDEX "CustomerInvoice_dealerId_dueDate_idx" ON "CustomerInvoice"("dealerId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInvoice_dealerId_number_key" ON "CustomerInvoice"("dealerId", "number");

-- CreateIndex
CREATE INDEX "VendorBill_dealerId_vendorId_status_idx" ON "VendorBill"("dealerId", "vendorId", "status");

-- CreateIndex
CREATE INDEX "VendorBill_dealerId_dueDate_idx" ON "VendorBill"("dealerId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_dealerId_number_key" ON "VendorBill"("dealerId", "number");

-- CreateIndex
CREATE INDEX "Payment_dealerId_date_idx" ON "Payment"("dealerId", "date");

-- CreateIndex
CREATE INDEX "Payment_dealerId_customerId_idx" ON "Payment"("dealerId", "customerId");

-- CreateIndex
CREATE INDEX "Payment_dealerId_vendorId_idx" ON "Payment"("dealerId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_dealerId_number_key" ON "Payment"("dealerId", "number");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_billId_idx" ON "PaymentAllocation"("billId");

-- CreateIndex
CREATE INDEX "Expense_dealerId_date_idx" ON "Expense"("dealerId", "date");

-- CreateIndex
CREATE INDEX "Expense_dealerId_vehicleId_idx" ON "Expense"("dealerId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_dealerId_number_key" ON "Expense"("dealerId", "number");

-- CreateIndex
CREATE INDEX "RecurringExpense_dealerId_nextDate_idx" ON "RecurringExpense"("dealerId", "nextDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_glAccountId_key" ON "BankAccount"("glAccountId");

-- CreateIndex
CREATE INDEX "BankAccount_dealerId_idx" ON "BankAccount"("dealerId");

-- CreateIndex
CREATE INDEX "BankTransaction_dealerId_bankAccountId_date_idx" ON "BankTransaction"("dealerId", "bankAccountId", "date");

-- CreateIndex
CREATE INDEX "BankReconciliation_dealerId_bankAccountId_statementDate_idx" ON "BankReconciliation"("dealerId", "bankAccountId", "statementDate");

-- CreateIndex
CREATE INDEX "FloorPlanNote_dealerId_vehicleId_idx" ON "FloorPlanNote"("dealerId", "vehicleId");

-- CreateIndex
CREATE INDEX "FloorPlanNote_dealerId_status_idx" ON "FloorPlanNote"("dealerId", "status");

-- CreateIndex
CREATE INDEX "FloorPlanTransaction_noteId_idx" ON "FloorPlanTransaction"("noteId");

-- CreateIndex
CREATE INDEX "AccountingAttachment_dealerId_entityType_entityId_idx" ON "AccountingAttachment"("dealerId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "SavedReportFilter_dealerId_userId_idx" ON "SavedReportFilter"("dealerId", "userId");

-- CreateIndex
CREATE INDEX "AccountingAuditLog_dealerId_createdAt_idx" ON "AccountingAuditLog"("dealerId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountingAuditLog_dealerId_entityType_entityId_idx" ON "AccountingAuditLog"("dealerId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "DealerMember" ADD CONSTRAINT "DealerMember_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerMember" ADD CONSTRAINT "DealerMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcctAccount" ADD CONSTRAINT "AcctAccount_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcctAccount" ADD CONSTRAINT "AcctAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AcctAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AcctAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxLine" ADD CONSTRAINT "TaxLine_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxLine" ADD CONSTRAINT "TaxLine_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxFilingPeriod" ADD CONSTRAINT "TaxFilingPeriod_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAcquisition" ADD CONSTRAINT "VehicleAcquisition_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAcquisition" ADD CONSTRAINT "VehicleAcquisition_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAcquisition" ADD CONSTRAINT "VehicleAcquisition_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAcquisition" ADD CONSTRAINT "VehicleAcquisition_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAcquisition" ADD CONSTRAINT "VehicleAcquisition_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIn" ADD CONSTRAINT "TradeIn_lienHolderVendorId_fkey" FOREIGN KEY ("lienHolderVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSale" ADD CONSTRAINT "VehicleSale_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSale" ADD CONSTRAINT "VehicleSale_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSale" ADD CONSTRAINT "VehicleSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSale" ADD CONSTRAINT "VehicleSale_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSale" ADD CONSTRAINT "VehicleSale_financeLenderVendorId_fkey" FOREIGN KEY ("financeLenderVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSale" ADD CONSTRAINT "VehicleSale_tradeInId_fkey" FOREIGN KEY ("tradeInId") REFERENCES "TradeIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSale" ADD CONSTRAINT "VehicleSale_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDepositEvent" ADD CONSTRAINT "CustomerDepositEvent_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "CustomerDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AcctAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AcctAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "AcctAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanNote" ADD CONSTRAINT "FloorPlanNote_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanNote" ADD CONSTRAINT "FloorPlanNote_lenderVendorId_fkey" FOREIGN KEY ("lenderVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanNote" ADD CONSTRAINT "FloorPlanNote_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanTransaction" ADD CONSTRAINT "FloorPlanTransaction_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "FloorPlanNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingAttachment" ADD CONSTRAINT "AccountingAttachment_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReportFilter" ADD CONSTRAINT "SavedReportFilter_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingAuditLog" ADD CONSTRAINT "AccountingAuditLog_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Integrity rules the application must not be able to break.
-- ---------------------------------------------------------------------------

-- A line is a debit or a credit, never both, never negative, never zero.
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_amounts_check"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0) AND ("debit" > 0 OR "credit" > 0));

ALTER TABLE "TaxRule"
  ADD CONSTRAINT "TaxRule_rate_check" CHECK ("rate" >= 0 AND "rate" <= 100),
  ADD CONSTRAINT "TaxRule_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

ALTER TABLE "AccountingSettings"
  ADD CONSTRAINT "AccountingSettings_fiscal_check"
  CHECK ("fiscalYearStartMonth" BETWEEN 1 AND 12 AND "fiscalYearStartDay" BETWEEN 1 AND 28);

ALTER TABLE "CustomerDeposit"
  ADD CONSTRAINT "CustomerDeposit_amounts_check"
  CHECK ("amount" > 0 AND "applied" >= 0 AND "refunded" >= 0 AND "applied" + "refunded" <= "amount");

ALTER TABLE "CustomerInvoice"
  ADD CONSTRAINT "CustomerInvoice_amounts_check" CHECK ("total" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total");

ALTER TABLE "VendorBill"
  ADD CONSTRAINT "VendorBill_amounts_check" CHECK ("total" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_check" CHECK ("amount" > 0);

ALTER TABLE "FloorPlanNote"
  ADD CONSTRAINT "FloorPlanNote_amounts_check"
  CHECK ("principal" > 0 AND "principalPaid" >= 0 AND "principalPaid" <= "principal");

-- A posted entry balances, has at least two lines, and every line and account
-- belongs to the entry's dealer. Checked at commit (deferred), so an entry and
-- its lines can be written in any order inside one transaction.
CREATE OR REPLACE FUNCTION acct_check_entry(p_entry uuid) RETURNS void AS $$
DECLARE
  e RECORD;
  d numeric;
  c numeric;
  n integer;
  foreign_rows integer;
BEGIN
  SELECT "id", "dealerId", "status", "total" INTO e FROM "JournalEntry" WHERE "id" = p_entry;
  IF NOT FOUND OR e."status" <> 'POSTED' THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
    INTO d, c, n FROM "JournalLine" WHERE "entryId" = p_entry;
  IF n < 2 THEN
    RAISE EXCEPTION 'Journal entry % has % line(s); a posted entry needs at least two', p_entry, n
      USING ERRCODE = 'check_violation';
  END IF;
  IF d <> c THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits % <> credits %', p_entry, d, c
      USING ERRCODE = 'check_violation';
  END IF;
  IF d <> e."total" THEN
    RAISE EXCEPTION 'Journal entry % total % does not match its lines (%)', p_entry, e."total", d
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT COUNT(*) INTO foreign_rows
    FROM "JournalLine" l JOIN "AcctAccount" a ON a."id" = l."accountId"
   WHERE l."entryId" = p_entry AND (l."dealerId" <> e."dealerId" OR a."dealerId" <> e."dealerId");
  IF foreign_rows > 0 THEN
    RAISE EXCEPTION 'Journal entry % uses another dealer''s accounts', p_entry
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION acct_check_entry_from_line() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM acct_check_entry(OLD."entryId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM acct_check_entry(NEW."entryId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION acct_check_entry_from_entry() RETURNS trigger AS $$
BEGIN
  PERFORM acct_check_entry(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalLine_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION acct_check_entry_from_line();

CREATE CONSTRAINT TRIGGER "JournalEntry_balanced"
  AFTER INSERT OR UPDATE ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION acct_check_entry_from_entry();

-- A posted entry is final: it cannot be deleted, returned to draft, re-dated
-- or re-amounted. Only the reversal bookkeeping fields may change.
CREATE OR REPLACE FUNCTION acct_protect_posted_entry() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'POSTED' THEN
      RAISE EXCEPTION 'Posted journal entry % cannot be deleted; reverse it instead', OLD."reference"
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'POSTED' AND (
       NEW."status" <> OLD."status" OR NEW."date" <> OLD."date" OR NEW."total" <> OLD."total"
    OR NEW."dealerId" <> OLD."dealerId" OR NEW."number" <> OLD."number"
    OR NEW."reference" <> OLD."reference" OR NEW."source" <> OLD."source" OR NEW."kind" <> OLD."kind"
    OR NEW."description" <> OLD."description"
    OR NEW."reversalOfId" IS DISTINCT FROM OLD."reversalOfId") THEN
    RAISE EXCEPTION 'Posted journal entry % cannot be changed; post an adjusting or reversing entry', OLD."reference"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_protect_posted"
  BEFORE UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION acct_protect_posted_entry();

-- Lines of a posted entry cannot be added later, removed, or changed — except
-- for their bank-reconciliation mark.
CREATE OR REPLACE FUNCTION acct_protect_posted_line() RETURNS trigger AS $$
DECLARE
  st "JournalStatus";
  created_here boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "status", (xmin::text = (txid_current() % 4294967296)::text)
      INTO st, created_here FROM "JournalEntry" WHERE "id" = NEW."entryId";
    IF st = 'POSTED' AND NOT created_here THEN
      RAISE EXCEPTION 'Lines cannot be added to a posted journal entry'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "status" INTO st FROM "JournalEntry" WHERE "id" = OLD."entryId";
  IF st = 'POSTED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Lines of a posted journal entry cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."accountId" <> OLD."accountId" OR NEW."debit" <> OLD."debit" OR NEW."credit" <> OLD."credit"
       OR NEW."entryId" <> OLD."entryId" OR NEW."dealerId" <> OLD."dealerId"
       OR NEW."vehicleId" IS DISTINCT FROM OLD."vehicleId"
       OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
       OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" THEN
      RAISE EXCEPTION 'Lines of a posted journal entry cannot be changed'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalLine_protect_posted"
  BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION acct_protect_posted_line();

-- Nothing is posted into a closed period. Corrections go into an open one.
CREATE OR REPLACE FUNCTION acct_reject_closed_period() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'POSTED' AND (TG_OP = 'INSERT' OR OLD."status" <> 'POSTED') THEN
    IF EXISTS (
      SELECT 1 FROM "AccountingPeriod" p
       WHERE p."dealerId" = NEW."dealerId" AND p."status" = 'CLOSED'
         AND NEW."date" BETWEEN p."startDate" AND p."endDate"
    ) THEN
      RAISE EXCEPTION 'The accounting period containing % is closed', NEW."date"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_open_period"
  BEFORE INSERT OR UPDATE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION acct_reject_closed_period();

-- Append-only records.
CREATE OR REPLACE FUNCTION acct_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountingAuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AccountingAuditLog"
  FOR EACH ROW EXECUTE FUNCTION acct_append_only();

CREATE TRIGGER "TaxLine_append_only"
  BEFORE UPDATE OR DELETE ON "TaxLine"
  FOR EACH ROW EXECUTE FUNCTION acct_append_only();

-- Financial documents are never hard-deleted once they have left draft.
CREATE OR REPLACE FUNCTION acct_forbid_delete_posted_document() RETURNS trigger AS $$
BEGIN
  IF to_jsonb(OLD) ? 'status' AND (to_jsonb(OLD) ->> 'status') = 'DRAFT' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A posted % cannot be deleted; reverse or void it instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['VehicleAcquisition', 'VehicleSale', 'CustomerDeposit', 'CustomerDepositEvent',
    'CustomerInvoice', 'VendorBill', 'Payment', 'PaymentAllocation', 'Expense', 'BankTransaction',
    'FloorPlanNote', 'FloorPlanTransaction']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION acct_forbid_delete_posted_document()',
      t || '_no_delete', t);
  END LOOP;
END;
$$;
