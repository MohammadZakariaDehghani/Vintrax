-- Email provider settings managed from the admin (D-069). Additive: one new
-- table; the API key column holds AES-256-GCM ciphertext only.

-- CreateTable
CREATE TABLE "EmailProviderSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fromName" TEXT NOT NULL DEFAULT 'Vintrax',
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "apiKeyCiphertext" TEXT,
    "apiKeyIv" TEXT,
    "apiKeyTag" TEXT,
    "apiKeyLast4" TEXT,
    "apiKeyKeyId" TEXT,
    "apiKeyUpdatedAt" TIMESTAMP(3),
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailProviderSettings_pkey" PRIMARY KEY ("id")
);

