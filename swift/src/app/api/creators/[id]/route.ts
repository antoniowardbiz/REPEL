import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ROLE_KEYS } from "@/lib/constants";

// PATCH /api/creators/[id] — edit a model's links: main page, general drive,
// and per-role drives ({x_va: url, reddit_va: url}). Empty string clears.
// These feed the trial briefs, the onboarding welcome, and the AI support agent.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);

  const cleanUrl = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined; // not provided → leave unchanged
    if (v === null || v === "") return null;
    const s = String(v).trim();
    if (!/^https?:\/\//i.test(s)) return undefined; // reject non-URLs silently
    return s;
  };

  const data: Record<string, string | null> = {};
  const drive = cleanUrl(body.contentDriveUrl);
  if (drive !== undefined) data.contentDriveUrl = drive;
  const main = cleanUrl(body.xMainUrl);
  if (main !== undefined) data.xMainUrl = main;

  // Per-role drives: merge onto the existing JSON so unmentioned roles keep theirs.
  if (body.drives && typeof body.drives === "object") {
    const creator = await prisma.creator.findUnique({ where: { id: params.id } });
    if (!creator) return fail("model not found", 404);
    let drives: Record<string, string> = {};
    try {
      drives = creator.contentDrives ? JSON.parse(creator.contentDrives) : {};
    } catch {
      drives = {};
    }
    for (const key of ROLE_KEYS) {
      if (!(key in body.drives)) continue;
      const v = cleanUrl(body.drives[key]);
      if (v === undefined) continue;
      if (v === null) delete drives[key];
      else drives[key] = v;
    }
    data.contentDrives = Object.keys(drives).length > 0 ? JSON.stringify(drives) : null;
  }

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
