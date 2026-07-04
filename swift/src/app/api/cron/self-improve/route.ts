import { ok, fail, cronAuthorized } from "@/lib/api";
import { runSelfImprovement } from "@/lib/self-improve";

// GET/POST /api/cron/self-improve?secret=... — the weekly self-improvement pass.
// Also runs weekly from the in-process scheduler; this is the manual/backup hit.
async function handle(req: Request) {
  if (!cronAuthorized(req)) return fail("unauthorized", 401);
  const res = await runSelfImprovement();
  return ok({ ok: true, ...res });
}
export const GET = handle;
export const POST = handle;
