-- Track whether the one-time "you've stalled at the account step" nudge has been
-- sent for a managed (Reddit) trial, so the follow-up sweep fires it exactly once.
ALTER TABLE "Trial" ADD COLUMN "managerNudgeSent" BOOLEAN NOT NULL DEFAULT false;
