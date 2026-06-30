import { ok, fail, readJSON } from "@/lib/api";
import { submitTrial } from "@/lib/services";

// POST /api/applications/[id]/submit — { submissionUrls: string[], accountUsed? }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJSON(req);
  let urls: string[] = [];
  if (Array.isArray(body.submissionUrls)) urls = body.submissionUrls.filter(Boolean);
  else if (typeof body.submissionUrls === "string") {
    urls = body.submissionUrls.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean);
  }
  if (urls.length === 0) return fail("at least one submission URL is required");
  try {
    const trial = await submitTrial(params.id, urls, body.accountUsed, body.actorUserId);
    return ok({ ok: true, trialId: trial.id });
  } catch (e: any) {
    return fail(e?.message ?? "submit failed", 500);
  }
}
