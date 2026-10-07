-- CreateEnum
CREATE TYPE "LeadStatusKind" AS ENUM ('OPEN', 'WON', 'LOST', 'NURTURE', 'UNRESPONSIVE');

-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "CrmTimelineType" AS ENUM ('CALL', 'EMAIL', 'SMS', 'MEETING', 'APPOINTMENT', 'NOTE', 'TASK', 'TEST_DRIVE', 'FOLLOW_UP', 'QUOTE', 'FINANCE', 'TRADE_IN', 'OTHER', 'LEAD_CREATED', 'LEAD_ASSIGNED', 'STATUS_CHANGED', 'FIRST_CONTACT', 'VEHICLE_VIEWED', 'VEHICLE_INQUIRY', 'CUSTOMER_REPLIED', 'EMAIL_SENT', 'EMAIL_OPENED', 'EMAIL_CLICKED', 'EMAIL_BOUNCED', 'EMAIL_FAILED', 'UNSUBSCRIBED', 'CONSENT_CHANGED', 'APPOINTMENT_BOOKED', 'APPOINTMENT_UPDATED', 'TASK_CREATED', 'TASK_COMPLETED', 'TRADE_IN_APPRAISAL', 'FINANCING_REQUESTED', 'DEPOSIT', 'SALE', 'DELIVERY', 'POST_SALE', 'CONVERTED', 'MERGED', 'TAG_ADDED', 'TAG_REMOVED', 'SCORE_CHANGED', 'AUTOMATION_STARTED', 'AUTOMATION_STEP', 'AUTOMATION_STOPPED');

-- CreateEnum
CREATE TYPE "CrmTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrmPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CrmRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('TEST_DRIVE', 'VEHICLE_VIEWING', 'SALES_MEETING', 'TRADE_IN_APPRAISAL', 'FINANCE_MEETING', 'DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CrmScope" AS ENUM ('DEALER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "EmailPurpose" AS ENUM ('TRANSACTIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "CrmEmailStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'SUPPRESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED', 'FAILED', 'UNSUBSCRIBED', 'COMPLAINED', 'SUPPRESSED', 'CANCELLED', 'RETRY');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'HARD_BOUNCE', 'INVALID', 'COMPLAINT', 'MANUAL');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('EXPRESS', 'IMPLIED_INQUIRY', 'IMPLIED_PURCHASE');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('LEAD_NURTURE', 'RE_ENGAGEMENT', 'NEW_INVENTORY', 'VEHICLE_PROMOTION', 'CUSTOMER_FOLLOW_UP', 'SOLD_CUSTOMER', 'SERVICE_REMINDER', 'SEASONAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'WAITING', 'COMPLETED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'WAITING_FOR_DEALER', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('ADMIN', 'USER_PORTAL', 'CONTACT_FORM', 'SUPPORT_CHAT', 'EMAIL');

-- CreateEnum
CREATE TYPE "TicketVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "AdminTaskType" AS ENUM ('FOLLOW_UP_DEALER', 'CALL_USER', 'INVESTIGATE', 'VERIFY_ACCOUNT', 'BILLING_FOLLOW_UP', 'REVIEW_FEATURE_REQUEST', 'ESCALATE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CRM_LEAD';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_TASK';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_APPOINTMENT';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_TICKET';

-- CreateTable
CREATE TABLE "CrmSettings" (
    "dealerId" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "sendWindowStartHour" INTEGER NOT NULL DEFAULT 9,
    "sendWindowEndHour" INTEGER NOT NULL DEFAULT 19,
    "sendDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "responseTargetMinutes" INTEGER NOT NULL DEFAULT 5,
    "hotThreshold" INTEGER NOT NULL DEFAULT 50,
    "warmThreshold" INTEGER NOT NULL DEFAULT 20,
    "noResponseDays" INTEGER NOT NULL DEFAULT 3,
    "inactiveDays" INTEGER NOT NULL DEFAULT 30,
    "assignmentMode" TEXT NOT NULL DEFAULT 'ROUND_ROBIN',
    "roundRobinCursor" INTEGER NOT NULL DEFAULT 0,
    "createFollowUpTask" BOOLEAN NOT NULL DEFAULT true,
    "senderName" TEXT,
    "replyToEmail" TEXT,
    "businessAddress" TEXT,
    "businessPhone" TEXT,
    "businessEmail" TEXT,
    "impliedConsentFromInquiry" BOOLEAN NOT NULL DEFAULT true,
    "impliedConsentFromPurchase" BOOLEAN NOT NULL DEFAULT true,
    "postSaleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSettings_pkey" PRIMARY KEY ("dealerId")
);

-- CreateTable
CREATE TABLE "CrmLeadStatus" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "LeadStatusKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "inPipeline" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CrmLeadStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLeadSource" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monthlyCostCents" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CrmLeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTag" (
    "id" UUID NOT NULL,
    "scope" "CrmScope" NOT NULL,
    "dealerId" UUID,
    "name" TEXT NOT NULL,
    "color" TEXT,

    CONSTRAINT "CrmTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "preferredContact" "PreferredContact",
    "address" TEXT,
    "city" TEXT,
    "province" "Province",
    "postalCode" TEXT,
    "sourceId" UUID,
    "campaign" TEXT,
    "vehicleId" UUID,
    "interestedVin" TEXT,
    "vehicleUrl" TEXT,
    "budgetCents" INTEGER,
    "financingInterest" BOOLEAN NOT NULL DEFAULT false,
    "tradeInInterest" BOOLEAN NOT NULL DEFAULT false,
    "tradeInVehicle" TEXT,
    "preferredAppointmentAt" TIMESTAMP(3),
    "notes" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "temperature" "LeadTemperature" NOT NULL DEFAULT 'COLD',
    "statusId" UUID NOT NULL,
    "lostReason" TEXT,
    "assignedToId" UUID,
    "team" TEXT,
    "assignedAt" TIMESTAMP(3),
    "userId" UUID,
    "customerId" UUID,
    "conversationId" UUID,
    "financeApplicationId" UUID,
    "firstContactAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "lastRepliedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "mergedIntoId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLeadTag" (
    "leadId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "CrmLeadTag_pkey" PRIMARY KEY ("leadId","tagId")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "userId" UUID,
    "type" "CrmTimelineType" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "status" TEXT,
    "notes" TEXT,
    "outcome" TEXT,
    "nextAction" TEXT,
    "vehicleId" UUID,
    "saleId" UUID,
    "emailId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTask" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "leadId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToId" UUID,
    "vehicleId" UUID,
    "dueAt" TIMESTAMP(3),
    "priority" "CrmPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'OPEN',
    "reminderAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "recurrence" "CrmRecurrence" NOT NULL DEFAULT 'NONE',
    "completedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAppointment" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "vehicleId" UUID,
    "salespersonId" UUID,
    "type" "AppointmentType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reminderMinutes" INTEGER DEFAULT 60,
    "reminderSentAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLeadScoreEvent" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "signal" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "scoreAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmLeadScoreEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmScoringRule" (
    "dealerId" UUID NOT NULL,
    "signal" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CrmScoringRule_pkey" PRIMARY KEY ("dealerId","signal")
);

-- CreateTable
CREATE TABLE "CrmAssignmentRule" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "matchField" TEXT NOT NULL,
    "matchValue" TEXT,
    "assignToUserId" UUID,
    "assignToTeam" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CrmAssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTeamMember" (
    "dealerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "team" TEXT NOT NULL,

    CONSTRAINT "CrmTeamMember_pkey" PRIMARY KEY ("dealerId","userId")
);

-- CreateTable
CREATE TABLE "CrmLeadImport" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "errors" JSONB,
    "mapping" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmLeadImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEmailTemplate" (
    "id" UUID NOT NULL,
    "scope" "CrmScope" NOT NULL,
    "dealerId" UUID,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "purpose" "EmailPurpose" NOT NULL DEFAULT 'TRANSACTIONAL',
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "history" JSONB,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmEmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEmail" (
    "id" UUID NOT NULL,
    "scope" "CrmScope" NOT NULL,
    "dealerId" UUID,
    "leadId" UUID,
    "ticketId" UUID,
    "userId" UUID,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "fromName" TEXT,
    "replyTo" TEXT,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "purpose" "EmailPurpose" NOT NULL,
    "templateId" UUID,
    "campaignId" UUID,
    "enrollmentId" UUID,
    "automationStepId" TEXT,
    "status" "CrmEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerMessageId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "trackingToken" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEmailEvent" (
    "id" UUID NOT NULL,
    "emailId" UUID NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmEmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSuppression" (
    "id" UUID NOT NULL,
    "dealerId" UUID,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmConsent" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "leadId" UUID,
    "email" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "source" TEXT NOT NULL,
    "evidence" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCampaign" (
    "id" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" UUID,
    "subject" TEXT,
    "audience" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "costCents" INTEGER,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAutomation" (
    "id" UUID NOT NULL,
    "scope" "CrmScope" NOT NULL,
    "dealerId" UUID,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "triggerConfig" JSONB,
    "steps" JSONB NOT NULL,
    "stopConditions" TEXT[],
    "respectSendWindow" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAutomationEnrollment" (
    "id" UUID NOT NULL,
    "automationId" UUID NOT NULL,
    "dealerId" UUID,
    "leadId" UUID,
    "ticketId" UUID,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStepId" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "stopReason" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CrmAutomationEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNotificationPreference" (
    "userId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CrmNotificationPreference_pkey" PRIMARY KEY ("userId","event")
);

-- CreateTable
CREATE TABLE "CrmAuditLog" (
    "id" UUID NOT NULL,
    "scope" "CrmScope" NOT NULL,
    "dealerId" UUID,
    "actorId" UUID,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCategory" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SupportCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTeam" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "memberIds" UUID[],
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SupportTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "firstResponseHours" JSONB NOT NULL DEFAULT '{"URGENT":1,"HIGH":4,"MEDIUM":24,"LOW":72}',
    "resolutionHours" JSONB NOT NULL DEFAULT '{"URGENT":8,"HIGH":24,"MEDIUM":72,"LOW":168}',
    "waitingReminderDays" INTEGER NOT NULL DEFAULT 3,
    "autoCloseDays" INTEGER NOT NULL DEFAULT 7,
    "defaultTeamId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "requesterId" UUID,
    "requesterEmail" TEXT NOT NULL,
    "requesterName" TEXT,
    "dealerId" UUID,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" UUID,
    "priority" "CrmPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "source" "TicketSource" NOT NULL DEFAULT 'ADMIN',
    "assignedToId" UUID,
    "teamId" UUID,
    "dueAt" TIMESTAMP(3),
    "firstResponseDueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "lastPublicReplyAt" TIMESTAMP(3),
    "lastPublicReplyBy" TEXT,
    "waitingSince" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "resolution" TEXT,
    "contactMessageId" UUID,
    "supportChatId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketTag" (
    "ticketId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "SupportTicketTag_pkey" PRIMARY KEY ("ticketId","tagId")
);

-- CreateTable
CREATE TABLE "SupportTicketMessage" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorId" UUID,
    "authorRole" TEXT NOT NULL,
    "visibility" "TicketVisibility" NOT NULL,
    "body" TEXT NOT NULL,
    "emailId" UUID,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketEvent" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "actorId" UUID,
    "type" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminTask" (
    "id" UUID NOT NULL,
    "type" "AdminTaskType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToId" UUID,
    "ticketId" UUID,
    "dealerId" UUID,
    "subjectUserId" UUID,
    "dueAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "priority" "CrmPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmLeadStatus_dealerId_position_idx" ON "CrmLeadStatus"("dealerId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLeadStatus_dealerId_key_key" ON "CrmLeadStatus"("dealerId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLeadSource_dealerId_key_key" ON "CrmLeadSource"("dealerId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTag_scope_dealerId_name_key" ON "CrmTag"("scope", "dealerId", "name") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_statusId_createdAt_idx" ON "CrmLead"("dealerId", "statusId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_assignedToId_nextFollowUpAt_idx" ON "CrmLead"("dealerId", "assignedToId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_emailNormalized_idx" ON "CrmLead"("dealerId", "emailNormalized");

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_phoneNormalized_idx" ON "CrmLead"("dealerId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_createdAt_idx" ON "CrmLead"("dealerId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_temperature_idx" ON "CrmLead"("dealerId", "temperature");

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_vehicleId_idx" ON "CrmLead"("dealerId", "vehicleId");

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_userId_idx" ON "CrmLead"("dealerId", "userId");

-- CreateIndex
CREATE INDEX "CrmLead_dealerId_customerId_idx" ON "CrmLead"("dealerId", "customerId");

-- CreateIndex
CREATE INDEX "CrmLead_mergedIntoId_idx" ON "CrmLead"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLead_dealerId_number_key" ON "CrmLead"("dealerId", "number");

-- CreateIndex
CREATE INDEX "CrmLeadTag_tagId_idx" ON "CrmLeadTag"("tagId");

-- CreateIndex
CREATE INDEX "CrmActivity_leadId_occurredAt_idx" ON "CrmActivity"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmActivity_dealerId_type_occurredAt_idx" ON "CrmActivity"("dealerId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmActivity_dealerId_userId_occurredAt_idx" ON "CrmActivity"("dealerId", "userId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmTask_dealerId_status_dueAt_idx" ON "CrmTask"("dealerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmTask_dealerId_assignedToId_status_dueAt_idx" ON "CrmTask"("dealerId", "assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmTask_leadId_idx" ON "CrmTask"("leadId");

-- CreateIndex
CREATE INDEX "CrmAppointment_dealerId_startsAt_idx" ON "CrmAppointment"("dealerId", "startsAt");

-- CreateIndex
CREATE INDEX "CrmAppointment_dealerId_salespersonId_startsAt_idx" ON "CrmAppointment"("dealerId", "salespersonId", "startsAt");

-- CreateIndex
CREATE INDEX "CrmAppointment_leadId_idx" ON "CrmAppointment"("leadId");

-- CreateIndex
CREATE INDEX "CrmLeadScoreEvent_leadId_createdAt_idx" ON "CrmLeadScoreEvent"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmAssignmentRule_dealerId_position_idx" ON "CrmAssignmentRule"("dealerId", "position");

-- CreateIndex
CREATE INDEX "CrmLeadImport_dealerId_createdAt_idx" ON "CrmLeadImport"("dealerId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmEmailTemplate_scope_dealerId_category_idx" ON "CrmEmailTemplate"("scope", "dealerId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEmailTemplate_scope_dealerId_key_key" ON "CrmEmailTemplate"("scope", "dealerId", "key");

-- Platform rows (no dealer) keyed once per scope; custom rows have no key.
CREATE UNIQUE INDEX "CrmEmailTemplate_platform_key" ON "CrmEmailTemplate"("scope", "key") WHERE "dealerId" IS NULL AND "key" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CrmEmail_idempotencyKey_key" ON "CrmEmail"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEmail_trackingToken_key" ON "CrmEmail"("trackingToken");

-- CreateIndex
CREATE INDEX "CrmEmail_status_nextAttemptAt_idx" ON "CrmEmail"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CrmEmail_dealerId_createdAt_idx" ON "CrmEmail"("dealerId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmEmail_dealerId_status_createdAt_idx" ON "CrmEmail"("dealerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CrmEmail_leadId_createdAt_idx" ON "CrmEmail"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmEmail_ticketId_createdAt_idx" ON "CrmEmail"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmEmail_campaignId_idx" ON "CrmEmail"("campaignId");

-- CreateIndex
CREATE INDEX "CrmEmail_providerMessageId_idx" ON "CrmEmail"("providerMessageId");

-- CreateIndex
CREATE INDEX "CrmEmailEvent_emailId_createdAt_idx" ON "CrmEmailEvent"("emailId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmEmailEvent_type_createdAt_idx" ON "CrmEmailEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "CrmSuppression_email_idx" ON "CrmSuppression"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSuppression_dealerId_email_reason_key" ON "CrmSuppression"("dealerId", "email", "reason") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "CrmConsent_dealerId_email_idx" ON "CrmConsent"("dealerId", "email");

-- CreateIndex
CREATE INDEX "CrmConsent_leadId_idx" ON "CrmConsent"("leadId");

-- CreateIndex
CREATE INDEX "CrmCampaign_dealerId_status_scheduledAt_idx" ON "CrmCampaign"("dealerId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CrmAutomation_scope_dealerId_trigger_isActive_idx" ON "CrmAutomation"("scope", "dealerId", "trigger", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CrmAutomation_scope_dealerId_key_key" ON "CrmAutomation"("scope", "dealerId", "key");

-- Platform rows (no dealer) keyed once per scope; custom rows have no key.
CREATE UNIQUE INDEX "CrmAutomation_platform_key" ON "CrmAutomation"("scope", "key") WHERE "dealerId" IS NULL AND "key" IS NOT NULL;

-- CreateIndex
CREATE INDEX "CrmAutomationEnrollment_status_nextRunAt_idx" ON "CrmAutomationEnrollment"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "CrmAutomationEnrollment_automationId_status_idx" ON "CrmAutomationEnrollment"("automationId", "status");

-- CreateIndex
CREATE INDEX "CrmAutomationEnrollment_leadId_status_idx" ON "CrmAutomationEnrollment"("leadId", "status");

-- CreateIndex
CREATE INDEX "CrmAutomationEnrollment_ticketId_status_idx" ON "CrmAutomationEnrollment"("ticketId", "status");

-- CreateIndex
CREATE INDEX "CrmAuditLog_scope_dealerId_createdAt_idx" ON "CrmAuditLog"("scope", "dealerId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmAuditLog_entityType_entityId_idx" ON "CrmAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCategory_key_key" ON "SupportCategory"("key");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTeam_name_key" ON "SupportTeam"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_contactMessageId_key" ON "SupportTicket"("contactMessageId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_createdAt_idx" ON "SupportTicket"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedToId_status_idx" ON "SupportTicket"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_requesterId_createdAt_idx" ON "SupportTicket"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_dealerId_createdAt_idx" ON "SupportTicket"("dealerId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_categoryId_createdAt_idx" ON "SupportTicket"("categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketMessage_ticketId_visibility_createdAt_idx" ON "SupportTicketMessage"("ticketId", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketEvent_ticketId_createdAt_idx" ON "SupportTicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminTask_assignedToId_status_dueAt_idx" ON "AdminTask"("assignedToId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "AdminTask_status_dueAt_idx" ON "AdminTask"("status", "dueAt");

-- CreateIndex
CREATE INDEX "AdminTask_dealerId_idx" ON "AdminTask"("dealerId");

-- CreateIndex
CREATE INDEX "AdminTask_subjectUserId_idx" ON "AdminTask"("subjectUserId");

-- AddForeignKey
ALTER TABLE "CrmSettings" ADD CONSTRAINT "CrmSettings_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadStatus" ADD CONSTRAINT "CrmLeadStatus_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadSource" ADD CONSTRAINT "CrmLeadSource_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTag" ADD CONSTRAINT "CrmTag_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CrmLeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "CrmLeadStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadTag" ADD CONSTRAINT "CrmLeadTag_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadTag" ADD CONSTRAINT "CrmLeadTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CrmTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAppointment" ADD CONSTRAINT "CrmAppointment_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAppointment" ADD CONSTRAINT "CrmAppointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAppointment" ADD CONSTRAINT "CrmAppointment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAppointment" ADD CONSTRAINT "CrmAppointment_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadScoreEvent" ADD CONSTRAINT "CrmLeadScoreEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmScoringRule" ADD CONSTRAINT "CrmScoringRule_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAssignmentRule" ADD CONSTRAINT "CrmAssignmentRule_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTeamMember" ADD CONSTRAINT "CrmTeamMember_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadImport" ADD CONSTRAINT "CrmLeadImport_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmailTemplate" ADD CONSTRAINT "CrmEmailTemplate_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmail" ADD CONSTRAINT "CrmEmail_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmail" ADD CONSTRAINT "CrmEmail_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmail" ADD CONSTRAINT "CrmEmail_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmail" ADD CONSTRAINT "CrmEmail_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CrmEmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmail" ADD CONSTRAINT "CrmEmail_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CrmCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEmailEvent" ADD CONSTRAINT "CrmEmailEvent_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "CrmEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSuppression" ADD CONSTRAINT "CrmSuppression_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConsent" ADD CONSTRAINT "CrmConsent_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConsent" ADD CONSTRAINT "CrmConsent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCampaign" ADD CONSTRAINT "CrmCampaign_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCampaign" ADD CONSTRAINT "CrmCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CrmEmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomation" ADD CONSTRAINT "CrmAutomation_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomationEnrollment" ADD CONSTRAINT "CrmAutomationEnrollment_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "CrmAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomationEnrollment" ADD CONSTRAINT "CrmAutomationEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomationEnrollment" ADD CONSTRAINT "CrmAutomationEnrollment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNotificationPreference" ADD CONSTRAINT "CrmNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SupportCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SupportTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketTag" ADD CONSTRAINT "SupportTicketTag_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketTag" ADD CONSTRAINT "SupportTicketTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CrmTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminTask" ADD CONSTRAINT "AdminTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminTask" ADD CONSTRAINT "AdminTask_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The CRM audit trail is append-only: rows can be added, never changed or removed.
CREATE OR REPLACE FUNCTION crm_audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CrmAuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crm_audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "CrmAuditLog"
  FOR EACH ROW EXECUTE FUNCTION crm_audit_log_append_only();
