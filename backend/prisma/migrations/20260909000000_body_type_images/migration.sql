-- CreateTable
CREATE TABLE "BodyTypeImage" (
    "bodyType" "BodyType" NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "alt" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BodyTypeImage_pkey" PRIMARY KEY ("bodyType")
);

-- AddForeignKey
ALTER TABLE "BodyTypeImage" ADD CONSTRAINT "BodyTypeImage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
