-- Admin-editable make logos (issue #43): an administrator's own image for a
-- vehicle make, overriding the generated mark `BrandLogo` otherwise draws.
--
-- Keyed on the make lowercased rather than an enum, because `Vehicle.make` is
-- free text a dealer types, unlike `BodyType`. The primary key is stored
-- lowercase by the application before every write and read here; the column
-- itself has no CHECK for that, matching how the rest of this schema trusts
-- application-level normalization rather than duplicating it in SQL.

-- CreateTable
CREATE TABLE "MakeLogo" (
    "make" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "alt" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakeLogo_pkey" PRIMARY KEY ("make")
);

-- AddForeignKey
ALTER TABLE "MakeLogo" ADD CONSTRAINT "MakeLogo_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
