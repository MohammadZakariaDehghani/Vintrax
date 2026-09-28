-- Video as a second media type for the home page promo tiles.
--
-- Additive: every existing tile becomes an IMAGE tile, exactly as it is today.
-- The tile's layout (widthSpan, heightPx, slot) is untouched and shared by
-- both media types. Written by hand from `prisma migrate diff`, less the
-- statements it always proposes for the search index Prisma does not model.

-- CreateEnum
CREATE TYPE "PromoTileMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "PromoTile" ADD COLUMN     "mediaType" "PromoTileMediaType" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "videoPosterUrl" TEXT,
ADD COLUMN     "videoUrl" TEXT;
