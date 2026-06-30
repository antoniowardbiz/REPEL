import { ok, fail, cronAuthorized } from "@/lib/api";
import { sendDailyDigest } from "@/lib/daily";

// GET/POST /api/cron/daily-digest?secret=... — operator's daily VA rundown.
// Schedule once/day (e.g. 21:00 local).
async function handle(req: Request) {
  if (!cronAuthorized(req)) return fail("unauthorized", 401);
  const text = await sendDailyDigest();
  return ok({ ok: true, digest: text });
}
export const GET = handle;
export const POST = handle;
