-- AlterTable
ALTER TABLE "InventoryImport" ADD COLUMN     "photosHeartbeatAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InventoryImport_photoStatus_idx" ON "InventoryImport"("photoStatus");
