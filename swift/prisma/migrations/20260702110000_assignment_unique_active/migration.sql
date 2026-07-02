-- Safety fix: prevent duplicate ACTIVE assignments for the same (user, role) —
-- the double-hire that a Telegram retry or double-tapped SUBMIT could create.
--
-- Step 1: collapse any pre-existing duplicates so the unique index applies
-- cleanly on live data. Keep the earliest active/probation assignment per
-- (userId, roleId); mark the rest 'ended'. On a clean DB this touches 0 rows.
UPDATE "Assignment" SET "status" = 'ended'
WHERE "status" IN ('probation', 'active')
  AND "rowid" NOT IN (
    SELECT MIN("rowid") FROM "Assignment"
    WHERE "status" IN ('probation', 'active')
    GROUP BY "userId", "roleId"
  );

-- Step 2: enforce it going forward. Partial unique index so a person can still
-- be re-assigned to the same role after an old assignment has 'ended'.
CREATE UNIQUE INDEX "Assignment_active_user_role_key"
  ON "Assignment" ("userId", "roleId")
  WHERE "status" IN ('probation', 'active');
