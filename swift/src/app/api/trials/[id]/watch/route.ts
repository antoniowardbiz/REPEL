import { ok, fail, readJSON } from "@/lib/api";
import { ensureTrialWatch, runTrialWatch } from "@/lib/watcher";
import { prisma } from "@/lib/db";

// POST /api/trials/[id]/watch — start (and optionally immediately run) a watch.
// Body: { run?: boolean, accountHandle?, intervalMins? }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  try {
    const watch = await ensureTrialWatch(params.id);
    const data: any = {};
    if (body.accountHandle) data.accountHandle = body.accountHandle;
    if (body.intervalMins) data.intervalMins = Number(body.intervalMins);
    if (Object.keys(data).length) await prisma.trialWatch.update({ where: { id: watch.id }, data });

    let result = null;
    if (body.run !== false) result = await runTrialWatch(watch.id);
    return ok({ ok: true, watchId: watch.id, result });
  } catch (e: any) {
    return fail(e?.message ?? "watch failed", 500);
  }
}
