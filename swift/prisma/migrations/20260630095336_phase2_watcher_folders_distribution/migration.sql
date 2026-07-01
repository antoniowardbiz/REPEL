-- AlterTable
ALTER TABLE "ScoreCard" ADD COLUMN "autoRating" INTEGER;

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "managerUserId" TEXT,
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'probation',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TelegramGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "roleId" TEXT,
    "creatorId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'general',
    "inviteUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TelegramGroup_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TelegramGroup_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" DATETIME,
    "removedAt" DATETIME,
    CONSTRAINT "GroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupMembership_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrialWatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trialId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountHandle" TEXT,
    "source" TEXT NOT NULL DEFAULT 'activity',
    "status" TEXT NOT NULL DEFAULT 'active',
    "intervalMins" INTEGER NOT NULL DEFAULT 60,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrialWatch_trialId_fkey" FOREIGN KEY ("trialId") REFERENCES "Trial" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrialObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchId" TEXT NOT NULL,
    "trialId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" TEXT NOT NULL DEFAULT '{}',
    "notes" TEXT,
    CONSTRAINT "TrialObservation_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "TrialWatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT,
    "userId" TEXT,
    "trialId" TEXT,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGroup_key_key" ON "TelegramGroup"("key");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMembership_groupId_candidateId_key" ON "GroupMembership"("groupId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialWatch_trialId_key" ON "TrialWatch"("trialId");
