import { ok, fail, cronAuthorized } from "@/lib/api";
import { runDailyCoaching } from "@/lib/coaching";

// GET/POST /api/cron/coaching?secret=... — the daily proactive-coaching pass.
// Schedule once/day (e.g. 20:00 local, after most posting is done).
async function handle(req: Request) {
  if (!cronAuthorized(req)) return fail("unauthorized", 401);
  const res = await runDailyCoaching();
  return ok({ ok: true, ...res });
}
export const GET = handle;
export const POST = handle;
