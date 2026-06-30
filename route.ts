import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";

// PATCH /api/templates/[id] — edit the message library.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  const data: any = {};
  for (const f of ["subject", "body", "category"]) if (f in body) data[f] = body[f];
  if ("active" in body) data.active = Boolean(body.active);
  if (Object.keys(data).length === 0) return fail("no updatable fields");
  try {
    const template = await prisma.messageTemplate.update({ where: { id: params.id }, data });
    return ok({ ok: true, template });
  } catch (e: any) {
    return fail(e?.message ?? "update failed", 500);
  }
}
