-- Site chat (D-061): visitors' conversations with the Vintrax assistant and
-- the team. New tables and enums only; nothing existing changes.

-- CreateEnum
CREATE TYPE "SupportChatStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportMessageRole" AS ENUM ('VISITOR', 'ASSISTANT', 'AGENT');

-- CreateTable
CREATE TABLE "SupportChat" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID,
    "visitorName" TEXT,
    "visitorEmail" TEXT,
    "pagePath" TEXT,
    "status" "SupportChatStatus" NOT NULL DEFAULT 'OPEN',
    "humanRequested" BOOLEAN NOT NULL DEFAULT false,
    "agentJoined" BOOLEAN NOT NULL DEFAULT false,
    "unreadByTeam" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportChatMessage" (
    "id" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "role" "SupportMessageRole" NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportChat_tokenHash_key" ON "SupportChat"("tokenHash");

-- CreateIndex
CREATE INDEX "SupportChat_status_lastMessageAt_idx" ON "SupportChat"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportChat_humanRequested_lastMessageAt_idx" ON "SupportChat"("humanRequested", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportChatMessage_chatId_createdAt_idx" ON "SupportChatMessage"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportChat" ADD CONSTRAINT "SupportChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportChatMessage" ADD CONSTRAINT "SupportChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "SupportChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportChatMessage" ADD CONSTRAINT "SupportChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
