import { ok, fail, readJSON } from "@/lib/api";
import { offboardUser } from "@/lib/accounts";

// POST /api/accounts/offboard — one-click offboard: revoke every active grant a
// VA holds.
export async function POST(req: Request) {
  const body = await readJSON(req);
  if (!body.userId || typeof body.userId !== "string") return fail("userId is required");
  try {
    const r = await offboardUser(body.userId);
    return ok({ ok: true, revoked: r.revoked });
  } catch (e: any) {
    return fail(e?.message ?? "failed to offboard", 500);
  }
}
