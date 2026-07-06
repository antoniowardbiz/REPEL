import { ok, fail } from "@/lib/api";
import { runActivationDrive } from "@/lib/activation";

// POST /api/assignments/activation-drive — nudge every stalled pre-active VA
// (role-selected / training / trial-ready) to START, with an incentive + their
// next step re-sent. Capped + spaced so repeat calls never spam. Triggered from
// /vas or fired automatically on boot + daily by the scheduler.
export async function POST() {
  try {
    const res = await runActivationDrive();
    return ok({ ok: true, ...res });
  } catch (e: any) {
    return fail(e?.message ?? "activation drive failed", 500);
  }
}
