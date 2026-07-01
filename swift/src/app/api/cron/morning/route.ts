import { ok, fail, cronAuthorized } from "@/lib/api";
import { sendMorningMessages } from "@/lib/daily";

// GET/POST /api/cron/morning?secret=... — morning improvement DMs to VAs on trial.
// Schedule once/day (e.g. 08:00 local).
async function handle(req: Request) {
  if (!cronAuthorized(req)) return fail("unauthorized", 401);
  const res = await sendMorningMessages();
  return ok({ ok: true, ...res });
}
export const GET = handle;
export const POST = handle;
