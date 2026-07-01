import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ROLE_KEYS } from "@/lib/constants";

// PATCH /api/roles/[key]/capacity — set a role's target headcount.
// Body: { capacity: number | null }. null (or "") = unlimited (never closes).
export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  if (!(ROLE_KEYS as readonly string[]).includes(params.key)) return fail("invalid role key");
  const body = await readJSON(req);

  let capacity: number | null;
  if (body.capacity === null || body.capacity === "" || body.capacity === undefined) {
    capacity = null;
  } else {
    const n = Number(body.capacity);
    if (!Number.isInteger(n) || n < 0) return fail("capacity must be a non-negative integer or null");
    capacity = n;
  }

  try {
    const role = await prisma.role.update({
      where: { key: params.key },
      data: { capacity },
    });
    await prisma.auditLog.create({
      data: { action: "role_capacity_set", entity: "Role", entityId: role.id, meta: JSON.stringify({ capacity }) },
    });
    return ok({ ok: true, key: role.key, capacity: role.capacity });
  } catch (e: any) {
    return fail(e?.message ?? "failed to update capacity", 500);
  }
}
