-- Finance applications (D-060): a buyer asks a seller to arrange financing for
-- one vehicle, and each seller chooses where new applications are announced.
-- New tables and enums only; nothing existing changes.

-- CreateEnum
CREATE TYPE "FinanceApplicationStatus" AS ENUM ('NEW', 'CONTACTED', 'IN_REVIEW', 'APPROVED', 'DECLINED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CreditRange" AS ENUM ('REBUILDING', 'FAIR', 'GOOD', 'EXCELLENT');

-- CreateEnum
CREATE TYPE "IncomeFrequency" AS ENUM ('ANNUALLY', 'MONTHLY', 'BIWEEKLY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('EMPLOYED', 'SELF_EMPLOYED', 'RETIRED', 'STUDENT', 'NOT_EMPLOYED', 'OTHER');

-- CreateEnum
CREATE TYPE "HousingStatus" AS ENUM ('OWN', 'RENT', 'WITH_FAMILY', 'OTHER');

-- CreateEnum
CREATE TYPE "PreferredContact" AS ENUM ('PHONE', 'EMAIL', 'TEXT');

-- CreateTable
CREATE TABLE "FinanceApplication" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "status" "FinanceApplicationStatus" NOT NULL DEFAULT 'NEW',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "dateOfBirth" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "creditRange" "CreditRange" NOT NULL,
    "grossIncomeCad" INTEGER NOT NULL,
    "incomeFrequency" "IncomeFrequency" NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL,
    "employerName" TEXT,
    "jobTitle" TEXT,
    "employmentMonths" INTEGER,
    "housingStatus" "HousingStatus" NOT NULL,
    "monthlyHousingCad" INTEGER,
    "addressMonths" INTEGER,
    "hasTradeIn" BOOLEAN NOT NULL DEFAULT false,
    "tradeInYear" INTEGER,
    "tradeInMake" TEXT,
    "tradeInModel" TEXT,
    "tradeInMileageKm" INTEGER,
    "tradeInOwedCad" INTEGER,
    "downPaymentCad" INTEGER NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "preferredContact" "PreferredContact" NOT NULL,
    "preferredVisitDate" TEXT,
    "comments" TEXT,
    "dealerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerFinanceSettings" (
    "sellerId" UUID NOT NULL,
    "acceptApplications" BOOLEAN NOT NULL DEFAULT true,
    "notificationEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerFinanceSettings_pkey" PRIMARY KEY ("sellerId")
);

-- CreateIndex
CREATE INDEX "FinanceApplication_sellerId_status_createdAt_idx" ON "FinanceApplication"("sellerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceApplication_sellerId_createdAt_idx" ON "FinanceApplication"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceApplication_applicantId_vehicleId_idx" ON "FinanceApplication"("applicantId", "vehicleId");

-- AddForeignKey
ALTER TABLE "FinanceApplication" ADD CONSTRAINT "FinanceApplication_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceApplication" ADD CONSTRAINT "FinanceApplication_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceApplication" ADD CONSTRAINT "FinanceApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerFinanceSettings" ADD CONSTRAINT "SellerFinanceSettings_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
