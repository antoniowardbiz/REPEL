import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";

// PATCH /api/assignments/[id] — set this VA's personalised OF tracking link
// (pulled from Infloww). Body: { promoLink: string | null }. Empty/null clears it.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);

  let promoLink: string | null;
  if (body.promoLink === null || body.promoLink === undefined || String(body.promoLink).trim() === "") {
    promoLink = null;
  } else {
    promoLink = String(body.promoLink).trim().slice(0, 500);
  }

  try {
    const assignment = await prisma.assignment.update({
      where: { id: params.id },
      data: { promoLink },
    });
    await prisma.auditLog.create({
      data: {
        action: "assignment_promo_link_set",
        entity: "Assignment",
        entityId: assignment.id,
        meta: JSON.stringify({ promoLink }),
      },
    });
    return ok({ ok: true, id: assignment.id, promoLink: assignment.promoLink });
  } catch (e: any) {
    return fail(e?.message ?? "failed to update link", 500);
  }
}
