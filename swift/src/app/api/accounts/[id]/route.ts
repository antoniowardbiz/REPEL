import { ok, fail, readJSON } from "@/lib/api";
import { setAccountStatus } from "@/lib/accounts";

// PATCH /api/accounts/[id] — update an account's warm-status.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  if (!body.status || typeof body.status !== "string") return fail("status is required");
  try {
    await setAccountStatus(params.id, body.status);
    return ok({ ok: true });
  } catch (e: any) {
    return fail(e?.message ?? "failed to update account", 500);
  }
}
