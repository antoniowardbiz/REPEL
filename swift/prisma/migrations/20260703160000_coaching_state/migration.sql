-- Per-VA coaching state: activity streaks + last-coached guard.
ALTER TABLE "Assignment" ADD COLUMN "lastActiveDay" DATETIME;
ALTER TABLE "Assignment" ADD COLUMN "activeStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Assignment" ADD COLUMN "bestStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Assignment" ADD COLUMN "lastCoachedDay" DATETIME;
