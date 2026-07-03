import { ok, fail } from "@/lib/api";
import { backfillPromoLinks } from "@/lib/services";

// POST /api/assignments/promo-backfill — generate a personal promo link for
// every current VA missing one (idempotent). Triggered by the button on /vas.
export async function POST() {
  try {
    const res = await backfillPromoLinks();
    return ok({ ok: true, ...res });
  } catch (e: any) {
    return fail(e?.message ?? "failed to backfill promo links", 500);
  }
}
