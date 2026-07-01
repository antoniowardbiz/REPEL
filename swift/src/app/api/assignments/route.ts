import { ok, fail, readJSON } from "@/lib/api";
import { assignVa, balanceReport } from "@/lib/distribution";

// GET /api/assignments — distribution snapshot.
export async function GET() {
  const report = await balanceReport();
  return ok({ ok: true, ...report });
}

// POST /api/assignments — assign a hired VA, auto-balancing across models if
// creatorId is omitted. Body: { userId, roleId, creatorId?, managerUserId? }
export async function POST(req: Request) {
  const body = await readJSON(req);
  if (!body.userId || !body.roleId) return fail("userId and roleId are required");
  try {
    const assignment = await assignVa({
      userId: body.userId,
      roleId: body.roleId,
      creatorId: body.creatorId ?? null,
      managerUserId: body.managerUserId ?? null,
    });
    return ok({ ok: true, assignmentId: assignment.id, creatorId: assignment.creatorId }, 201);
  } catch (e: any) {
    return fail(e?.message ?? "assignment failed", 500);
  }
}
