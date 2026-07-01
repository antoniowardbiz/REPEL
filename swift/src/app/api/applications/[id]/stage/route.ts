import { ok, fail, readJSON } from "@/lib/api";
import { moveStage } from "@/lib/services";
import { STAGES, Stage } from "@/lib/constants";

// POST /api/applications/[id]/stage — { to } move the application to a stage,
// firing any automations for the destination stage.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  const to = body.to as Stage;
  if (!to || !(STAGES as readonly string[]).includes(to)) {
    return fail("valid target stage `to` is required");
  }
  try {
    const result = await moveStage(params.id, to, body.actorUserId);
    return ok({ ok: true, ...result });
  } catch (e: any) {
    return fail(e?.message ?? "stage change failed", 500);
  }
}
