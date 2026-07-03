-- Add an editable pay line per role. NULL = fall back to the ROLE_PAY code default.
ALTER TABLE "Role" ADD COLUMN "pay" TEXT;
