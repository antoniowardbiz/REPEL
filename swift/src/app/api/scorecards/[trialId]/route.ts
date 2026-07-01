import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";
import { computeWeightedTotal, tierFor } from "@/lib/scoring";
import { parseCriteria } from "@/lib/serialize";
import { RubricCriterion } from "@/lib/constants";

// PATCH /api/scorecards/[trialId] — save a DRAFT (no finalize): scores, flags,
// rationale. Recomputes weightedTotal + provisional tier.
export async function PATCH(req: Request, { params }: { params: { trialId: string } }) {
  const body = await readJSON(req);
  const trial = await prisma.trial.findUnique({
    where: { id: params.trialId },
    include: { application: { include: { role: { include: { rubric: true } } } } },
  });
  if (!trial) return fail("trial not found", 404);

  const criteria: RubricCriterion[] = parseCriteria(trial.application.role.rubric?.criteria);
  const scores: Record<string, number> = body.scores ?? {};
  const flags: string[] = Array.isArray(body.flags) ? body.flags : [];
  const total = computeWeightedTotal(scores, criteria);
  const tier = tierFor(total, flags);

  try {
    const card = await prisma.scoreCard.upsert({
      where: { trialId: params.trialId },
      update: {
        scores: JSON.stringify(scores),
        flags: JSON.stringify(flags),
        rationale: body.rationale ?? null,
        weightedTotal: total,
        tier,
      },
      create: {
        trialId: params.trialId,
        scores: JSON.stringify(scores),
        flags: JSON.stringify(flags),
        rationale: body.rationale ?? null,
        weightedTotal: total,
        tier,
        finalized: false,
      },
    });
    return ok({ ok: true, weightedTotal: total, tier, cardId: card.id });
  } catch (e: any) {
    return fail(e?.message ?? "save failed", 500);
  }
}
