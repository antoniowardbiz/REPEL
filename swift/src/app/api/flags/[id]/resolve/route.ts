import { ok, fail } from "@/lib/api";
import { resolveFlag } from "@/lib/signals";

// POST /api/flags/[id]/resolve — mark a "needs attention" flag handled.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await resolveFlag(params.id);
    return ok({ ok: true });
  } catch (e: any) {
    return fail(e?.message ?? "failed to resolve", 500);
  }
}
