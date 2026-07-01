import { ok, fail } from "@/lib/api";
import { aiDraftScore } from "@/lib/ai-scoring";

// POST /api/scorecards/[trialId]/ai-draft — ask Claude to draft the scorecard.
// Returns { available:false, reason } (not an error) when no ANTHROPIC_API_KEY
// is configured, so the UI can degrade gracefully.
export async function POST(_req: Request, { params }: { params: { trialId: string } }) {
  try {
    const result = await aiDraftScore(params.trialId);
    if (!result.available) return ok({ ok: true, available: false, reason: result.reason });
    return ok({ ok: true, available: true, draft: result.draft });
  } catch (e: any) {
    return fail(e?.message ?? "AI draft failed", 500);
  }
}
