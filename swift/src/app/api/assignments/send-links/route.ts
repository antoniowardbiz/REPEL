import { ok, fail } from "@/lib/api";
import { sendPersonalLinks } from "@/lib/services";

// POST /api/assignments/send-links — DM every active VA their personal promo
// link (backfills any missing ones first). Triggered from /vas.
export async function POST() {
  try {
    const res = await sendPersonalLinks();
    return ok({ ok: true, ...res });
  } catch (e: any) {
    return fail(e?.message ?? "failed to send links", 500);
  }
}
