-- Platform email log and outbox (D-068). Additive only: two new tables and two
-- enums; nothing existing is altered.

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('SECURITY', 'ACCOUNT', 'NOTIFICATION', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('QUEUED', 'SENDING', 'ACCEPTED', 'DELAYED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SUPPRESSED', 'SKIPPED');

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" UUID NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT,
    "userId" UUID,
    "dealerId" UUID,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "payload" JSONB,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_idempotencyKey_key" ON "EmailMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailMessage_status_nextAttemptAt_idx" ON "EmailMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailMessage_category_createdAt_idx" ON "EmailMessage"("category", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_status_createdAt_idx" ON "EmailMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_providerMessageId_idx" ON "EmailMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_toEmail_idx" ON "EmailMessage"("toEmail");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_createdAt_idx" ON "EmailMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailWebhookEvent_providerMessageId_idx" ON "EmailWebhookEvent"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailWebhookEvent_receivedAt_idx" ON "EmailWebhookEvent"("receivedAt");

