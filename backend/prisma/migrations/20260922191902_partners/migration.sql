-- `prisma migrate dev`'s generated diff also proposed dropping
-- `Vehicle.searchVector` and its two trigram indexes: that column is
-- deliberately unmodeled in schema.prisma (see the same note in
-- 20260922190452_manual_vehicle_badges/migration.sql), unrelated to this
-- migration, and left alone here.

-- CreateTable
CREATE TABLE "Partner" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT NOT NULL,
    "alt" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Partner_enabled_createdAt_idx" ON "Partner"("enabled", "createdAt");

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
