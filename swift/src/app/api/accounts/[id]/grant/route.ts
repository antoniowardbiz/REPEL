import { ok, fail, readJSON } from "@/lib/api";
import { grantAccess } from "@/lib/accounts";

// POST /api/accounts/[id]/grant — give a VA access to this account.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  if (!body.userId || typeof body.userId !== "string") return fail("userId is required");
  try {
    const grant = await grantAccess(params.id, body.userId, body.note ?? null);
    return ok({ ok: true, grantId: grant.id }, 201);
  } catch (e: any) {
    return fail(e?.message ?? "failed to grant access", 500);
  }
}
