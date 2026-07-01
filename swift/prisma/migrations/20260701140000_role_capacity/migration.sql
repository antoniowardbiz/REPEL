-- Mass-hire: per-role target headcount. When a role's active funnel reaches
-- this number the role "closes" on the public apply form and new pickers are
-- steered to the most-needed open role. NULL = unlimited (never closes).
ALTER TABLE "Role" ADD COLUMN "capacity" INTEGER;
