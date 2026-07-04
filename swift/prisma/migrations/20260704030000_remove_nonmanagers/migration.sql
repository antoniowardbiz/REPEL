-- Hera, Zaidee and Tina are Reddit VAs, not managers. They were seeded as
-- manager records by mistake; remove them from the live data. Idempotent —
-- re-running finds nothing. Only touches manager-role users with these names.

-- Detach anything that points at them as a manager, so the delete is clean.
UPDATE "Role" SET "managerUserId" = NULL
  WHERE "managerUserId" IN (SELECT "id" FROM "User" WHERE "role" = 'manager' AND "name" IN ('Hera', 'Zaidee', 'Tina'));
UPDATE "Assignment" SET "managerUserId" = NULL
  WHERE "managerUserId" IN (SELECT "id" FROM "User" WHERE "role" = 'manager' AND "name" IN ('Hera', 'Zaidee', 'Tina'));

-- Remove their model links, then the manager records themselves.
DELETE FROM "CreatorManager"
  WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'manager' AND "name" IN ('Hera', 'Zaidee', 'Tina'));
DELETE FROM "User"
  WHERE "role" = 'manager' AND "name" IN ('Hera', 'Zaidee', 'Tina');
