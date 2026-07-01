-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN "startToken" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Trial" (
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
    "remind12hSent" BOOLEAN NOT NULL DEFAULT false,
    "remind2hSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trial_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trial_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Trial" ("accountUsed", "applicationId", "briefSentAt", "contentDriveUrl", "createdAt", "creatorId", "deadlineAt", "id", "startedAt", "status", "submissionUrls", "submittedAt", "updatedAt") SELECT "accountUsed", "applicationId", "briefSentAt", "contentDriveUrl", "createdAt", "creatorId", "deadlineAt", "id", "startedAt", "status", "submissionUrls", "submittedAt", "updatedAt" FROM "Trial";
DROP TABLE "Trial";
ALTER TABLE "new_Trial" RENAME TO "Trial";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_startToken_key" ON "Candidate"("startToken");

