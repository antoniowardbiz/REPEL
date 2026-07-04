-- Per-VA subs + earnings, imported from Infloww and matched by trial-link label.
ALTER TABLE "Assignment" ADD COLUMN "subs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Assignment" ADD COLUMN "earningsCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Assignment" ADD COLUMN "earningsSyncedAt" DATETIME;
