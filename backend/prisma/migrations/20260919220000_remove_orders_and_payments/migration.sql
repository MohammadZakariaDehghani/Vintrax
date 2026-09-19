-- Removes the online checkout system (the "orders" API, `TransactionRecord`
-- and `Payment`): there is no online buying in this system. A fixed-price
-- listing or an auction win is now arranged directly between buyer and
-- seller, off-platform, the same as any other sale never had one.
--
-- Auction settlement no longer creates any record here either — closing an
-- auction now marks the won vehicle SOLD directly (see AuctionsService.close),
-- so `Auction.winnerId`/`winningBidId` remain the permanent record of who won
-- and at what price, with nothing further to complete.

-- AlterEnum
-- PAYMENT_RECEIVED and PAYMENT_DUE were declared but never emitted by any
-- notification path.
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('BID_PLACED', 'OUTBID', 'AUCTION_WON', 'AUCTION_LOST', 'AUCTION_STARTING', 'AUCTION_ENDING', 'LISTING_APPROVED', 'LISTING_REJECTED', 'INSPECTION_COMPLETED', 'MESSAGE_RECEIVED', 'DEALER_VERIFIED', 'SYSTEM');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionRecord" DROP CONSTRAINT "TransactionRecord_auctionId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionRecord" DROP CONSTRAINT "TransactionRecord_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionRecord" DROP CONSTRAINT "TransactionRecord_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionRecord" DROP CONSTRAINT "TransactionRecord_shippingAddressId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionRecord" DROP CONSTRAINT "TransactionRecord_vehicleId_fkey";

-- DropTable
DROP TABLE "Payment";

-- DropTable
DROP TABLE "TransactionRecord";

-- DropEnum
DROP TYPE "PaymentMethod";

-- DropEnum
DROP TYPE "PaymentStatus";

-- DropEnum
DROP TYPE "TransactionStatus";
