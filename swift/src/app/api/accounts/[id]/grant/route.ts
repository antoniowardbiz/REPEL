import { ok, fail, readJSON } from "@/lib/api";
import { grantAccess } from "@/lib/accounts";
import { deliverAccountLogin } from "@/lib/services";

// POST /api/accounts/[id]/grant — give a VA access to this account AND DM them
// the login, so a manual grant reaches the VA just like the auto-handout does.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  if (!body.userId || typeof body.userId !== "string") return fail("userId is required");
  try {
    const grant = await grantAccess(params.id, body.userId, body.note ?? null);
    // Send the login to the VA. Never fail the grant if the DM can't go out —
    // return why so the operator knows if they still need to hand it over.
    const dm = await deliverAccountLogin(params.id, body.userId).catch(() => ({
      sent: false as const,
      reason: "the DM errored",
    }));
    return ok({ ok: true, grantId: grant.id, loginSent: dm.sent, dmReason: dm.reason ?? null }, 201);
  } catch (e: any) {
    return fail(e?.message ?? "failed to grant access", 500);
  }
}
