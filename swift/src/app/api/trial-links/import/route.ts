import { ok, fail, readJSON } from "@/lib/api";
import { importTrialLinks } from "@/lib/trial-links";

// POST /api/trial-links/import — bulk-import Infloww free-trial links from
// pasted text. Each line needs a label (e.g. LOLA-R-3) and a URL; the label
// gives the model + platform. Body: { text: string }.
export async function POST(req: Request) {
  const body = await readJSON(req);
  if (!body.text || typeof body.text !== "string") return fail("paste your Infloww links first");
  try {
    const res = await importTrialLinks(body.text);
    return ok({ ok: true, ...res });
  } catch (e: any) {
    return fail(e?.message ?? "failed to import links", 500);
  }
}
