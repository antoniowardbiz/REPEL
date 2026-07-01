import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/services";

// PATCH /api/candidates/[id] — update notes / archive / contact fields.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  const data: any = {};
  for (const f of ["notes", "telegramHandle", "telegramChatId", "email", "country", "timezone", "whyText"]) {
    if (f in body) data[f] = body[f];
  }
  if ("archived" in body) data.archived = Boolean(body.archived);
  if (Object.keys(data).length === 0) return fail("no updatable fields provided");
  try {
    const candidate = await prisma.candidate.update({ where: { id: params.id }, data });
    await auditLog("candidate_updated", "Candidate", params.id, Object.keys(data));
    return ok({ ok: true, candidate });
  } catch (e: any) {
    return fail(e?.message ?? "update failed", 500);
  }
}
