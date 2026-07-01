-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "niche" TEXT,
    "personaNotes" TEXT,
    "xMainUrl" TEXT,
    "igHandle" TEXT,
    "tiktokHandle" TEXT,
    "contentDriveUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "trialHours" INTEGER NOT NULL DEFAULT 24,
    "trainingGroupUrl" TEXT,
    "defaultCreatorId" TEXT,
    "managerUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Role_defaultCreatorId_fkey" FOREIGN KEY ("defaultCreatorId") REFERENCES "Creator" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Role_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "telegramHandle" TEXT,
    "telegramChatId" TEXT,
    "email" TEXT,
    "source" TEXT NOT NULL DEFAULT 'onlinejobs_ph',
    "timezone" TEXT,
    "country" TEXT,
    "whyText" TEXT,
    "notes" TEXT,
    "currentStage" TEXT NOT NULL DEFAULT 'APPLIED',
    "currentRoleId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Candidate_currentRoleId_fkey" FOREIGN KEY ("currentRoleId") REFERENCES "Role" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "whyText" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'APPLIED',
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Application_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "creatorId" TEXT,
    "contentDriveUrl" TEXT,
    "accountUsed" TEXT,
    "briefSentAt" DATETIME,
    "startedAt" DATETIME,
    "deadlineAt" DATETIME,
    "submissionUrls" TEXT NOT NULL DEFAULT '[]',
    "submittedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trial_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trial_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rubric_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScoreCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trialId" TEXT NOT NULL,
    "scorerUserId" TEXT,
    "aiDraft" TEXT,
    "scores" TEXT NOT NULL DEFAULT '{}',
    "flags" TEXT NOT NULL DEFAULT '[]',
    "weightedTotal" REAL NOT NULL DEFAULT 0,
    "tier" TEXT,
    "rationale" TEXT,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "scoredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScoreCard_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "Trial" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreCard_scorerUserId_fkey" FOREIGN KEY ("scorerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "roleId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "category" TEXT NOT NULL DEFAULT 'other',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MessageTemplate_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'va',
    "telegramHandle" TEXT,
    "email" TEXT,
    "payRate" TEXT,
    "paymentMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "candidateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "applicationId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "templateKey" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'ops',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Rubric_roleId_key" ON "Rubric"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreCard_trialId_key" ON "ScoreCard"("trialId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_key_key" ON "MessageTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "User_candidateId_key" ON "User"("candidateId");
