import { ok, fail, readJSON } from "@/lib/api";
import { sendTemplatedMessage, sendFirstTouch } from "@/lib/services";

// POST /api/messages/send — quick-send a templated message.
// Body: { applicationId, category } OR { candidateId } for first-touch.
export async function POST(req: Request) {
  const body = await readJSON(req);
  try {
    if (body.applicationId && body.category) {
      const r = await sendTemplatedMessage(body.applicationId, body.category, body.extra);
      if (r.skipped) return fail(`no template: ${r.reason}`, 404);
      return ok({ ok: true, sendStatus: r.sendStatus, messageId: r.message.id });
    }
    if (body.candidateId) {
      const r = await sendFirstTouch(body.candidateId);
      if (r.skipped) return fail("no first-touch template", 404);
      return ok({ ok: true, messageId: r.message.id });
    }
    return fail("provide {applicationId, category} or {candidateId}");
  } catch (e: any) {
    return fail(e?.message ?? "send failed", 500);
  }
}
