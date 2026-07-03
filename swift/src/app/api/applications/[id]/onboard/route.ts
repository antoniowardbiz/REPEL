import { ok, fail } from "@/lib/api";
import { onboardAndActivate } from "@/lib/services";

// POST /api/applications/[id]/onboard — hire this candidate right now: create
// their VA record, assign a model, auto-hand a pool account, and DM their full
// setup + promo link. One-click onboard for a VA you added by hand (skips the
// trial). After this they appear on the Accounts page and can hold accounts.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await onboardAndActivate(params.id);
    return ok({ ok: true });
  } catch (e: any) {
    return fail(e?.message ?? "onboard failed", 500);
  }
}
