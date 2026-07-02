-- Per-role content drives: each model can have a different folder per role
-- (e.g. Lola's X content vs Lola's Reddit content). JSON {roleKey: url};
-- contentDriveUrl remains the general fallback.
ALTER TABLE "Creator" ADD COLUMN "contentDrives" TEXT;
