import { ok, fail, readJSON } from "@/lib/api";
import { finalizeScoreCard } from "@/lib/services";

// POST /api/scorecards/[trialId]/finalize — finalize the scorecard, move the
// application to DECISION, and (optionally) fire the outcome template.
export async function POST(req: Request, { params }: { params: { trialId: string } }) {
  const body = await readJSON(req);
  if (!body.scores || typeof body.scores !== "object") return fail("scores object is required");
  try {
    const result = await finalizeScoreCard(params.trialId, {
      scores: body.scores,
      flags: Array.isArray(body.flags) ? body.flags : [],
      rationale: body.rationale,
      scorerUserId: body.scorerUserId,
      autoSendOutcome: body.autoSendOutcome !== false, // default true
    });
    return ok({ ok: true, total: result.total, tier: result.tier, outcome: result.outcome });
  } catch (e: any) {
    return fail(e?.message ?? "finalize failed", 500);
  }
}
