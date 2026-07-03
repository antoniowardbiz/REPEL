-- Per-VA Infloww trial link, assigned from the pool at hire.
ALTER TABLE "Assignment" ADD COLUMN "trialLinkUrl" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "trialLinkLabel" TEXT;

-- The pool of importable Infloww free-trial links.
CREATE TABLE "TrialLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "assignmentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrialLink_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrialLink_url_key" ON "TrialLink"("url");
CREATE UNIQUE INDEX "TrialLink_assignmentId_key" ON "TrialLink"("assignmentId");
CREATE INDEX "TrialLink_creatorId_platform_status_idx" ON "TrialLink"("creatorId", "platform", "status");
