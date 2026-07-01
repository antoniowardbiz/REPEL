import { ok, fail, cronAuthorized } from "@/lib/api";
import { runDueWatches } from "@/lib/watcher";

// GET/POST /api/cron/watch?secret=... — run every due trial watch.
// Schedule hourly (Vercel Cron, GitHub Actions, or any external cron).
async function handle(req: Request) {
  if (!cronAuthorized(req)) return fail("unauthorized", 401);
  const results = await runDueWatches();
  return ok({ ok: true, ran: results.length, results });
}
export const GET = handle;
export const POST = handle;
