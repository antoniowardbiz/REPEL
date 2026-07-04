import { ok, fail, readJSON } from "@/lib/api";
import { importEarnings } from "@/lib/earnings";

// POST /api/earnings/import — paste Infloww's export; match each link label to
// its VA and store subs + earnings. Body: { text: string }.
export async function POST(req: Request) {
  const body = await readJSON(req);
  if (!body.text || typeof body.text !== "string") return fail("paste your Infloww earnings first");
  try {
    const res = await importEarnings(body.text);
    return ok({ ok: true, ...res });
  } catch (e: any) {
    return fail(e?.message ?? "failed to import earnings", 500);
  }
}
