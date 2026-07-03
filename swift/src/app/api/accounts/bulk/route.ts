import { ok, fail, readJSON } from "@/lib/api";
import { createAccountsBulk } from "@/lib/accounts";

// POST /api/accounts/bulk — load a batch of bought accounts into the pool.
// Body: { platform: string, creatorId?: string|null, text: string }
// `text` is the pasted list, one credential per line ("username:password" …).
export async function POST(req: Request) {
  const body = await readJSON(req);
  const platform = String(body.platform ?? "").trim();
  if (!platform) return fail("platform required");
  const text = String(body.text ?? "");
  const lines = text.split(/\r?\n/);
  if (!lines.some((l) => l.trim())) return fail("no accounts pasted");

  try {
    const res = await createAccountsBulk({
      platform,
      creatorId: body.creatorId || null,
      lines,
    });
    return ok({ ok: true, ...res });
  } catch (e: any) {
    return fail(e?.message ?? "bulk add failed", 500);
  }
}
