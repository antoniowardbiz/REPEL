import { ok, fail, readJSON } from "@/lib/api";
import { revokeGrant } from "@/lib/accounts";

// POST /api/accounts/revoke — revoke a single access grant.
export async function POST(req: Request) {
  const body = await readJSON(req);
  if (!body.grantId || typeof body.grantId !== "string") return fail("grantId is required");
  try {
    await revokeGrant(body.grantId);
    return ok({ ok: true });
  } catch (e: any) {
    return fail(e?.message ?? "failed to revoke access", 500);
  }
}
