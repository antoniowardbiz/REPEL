-- "Needs attention" flags: VA-reported content-low / account-issue signals.
CREATE TABLE "OpsFlag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "creatorId" TEXT,
    "platform" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "OpsFlag_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OpsFlag_status_kind_idx" ON "OpsFlag"("status", "kind");
