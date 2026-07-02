import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";

// PATCH /api/creators/[id] — edit a model's links (content drive, main page).
// Empty string clears a link. These feed the trial briefs, the onboarding
// welcome, and the AI support agent's context.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);

  const clean = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined; // not provided → leave unchanged
    if (v === null || v === "") return null;
    const s = String(v).trim();
    if (!/^https?:\/\//i.test(s)) return undefined; // reject non-URLs silently
    return s;
  };

  const data: Record<string, string | null> = {};
  const drive = clean(body.contentDriveUrl);
  if (drive !== undefined) data.contentDriveUrl = drive;
  const main = clean(body.xMainUrl);
  if (main !== undefined) data.xMainUrl = main;
  if (Object.keys(data).length === 0) return fail("nothing to update (URLs must start with http)");

  try {
    const creator = await prisma.creator.update({ where: { id: params.id }, data });
    await prisma.auditLog.create({
      data: {
        action: "creator_links_updated",
        entity: "Creator",
        entityId: creator.id,
        meta: JSON.stringify(data),
      },
    });
    return ok({ ok: true, id: creator.id });
  } catch (e: any) {
    return fail(e?.message ?? "failed to update model", 500);
  }
}
