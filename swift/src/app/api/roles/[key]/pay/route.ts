import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ROLE_KEYS } from "@/lib/constants";

// PATCH /api/roles/[key]/pay — set the pay line VAs see (welcome + AI support).
// Body: { pay: string | null }. Empty/null clears it → falls back to the
// ROLE_PAY code default. Live: no deploy needed.
export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  if (!(ROLE_KEYS as readonly string[]).includes(params.key)) return fail("invalid role key");
  const body = await readJSON(req);

  let pay: string | null;
  if (body.pay === null || body.pay === undefined || String(body.pay).trim() === "") {
    pay = null;
  } else {
    pay = String(body.pay).trim().slice(0, 300); // guard against runaway input
  }

  try {
    const role = await prisma.role.update({
      where: { key: params.key },
      data: { pay },
    });
    await prisma.auditLog.create({
      data: { action: "role_pay_set", entity: "Role", entityId: role.id, meta: JSON.stringify({ pay }) },
    });
    return ok({ ok: true, key: role.key, pay: role.pay });
  } catch (e: any) {
    return fail(e?.message ?? "failed to update pay", 500);
  }
}
