-- CreateTable
CREATE TABLE "PromoTile" (
    "id" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "imageAlt" TEXT,
    "linkUrl" TEXT,
    "widthSpan" INTEGER NOT NULL DEFAULT 4,
    "heightPx" INTEGER NOT NULL DEFAULT 220,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoTile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoTile_slot_key" ON "PromoTile"("slot");

-- AddForeignKey
ALTER TABLE "PromoTile" ADD CONSTRAINT "PromoTile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
