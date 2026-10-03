-- Accounting (D-065): a draft sale keeps the deal as entered.
ALTER TABLE "VehicleSale" ADD COLUMN "draft" JSONB;
