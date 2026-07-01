import { RubricCriterion, Tier, TIER_THRESHOLDS } from "./constants";

/**
 * Weighted total = Σ( score/5 × weight ), expressed 0–100.
 * Criteria are each scored 0–5; weights across a rubric sum to 100.
 * An unscored criterion contributes 0.
 */
export function computeWeightedTotal(
  scores: Record<string, number>,
  criteria: RubricCriterion[]
): number {
  const total = criteria.reduce((acc, c) => {
    const raw = Number(scores[c.key] ?? 0);
    const clamped = Math.max(0, Math.min(5, raw));
    return acc + (clamped / 5) * c.weight;
  }, 0);
  // round to 1 decimal place
  return Math.round(total * 10) / 10;
}

/**
 * Map a weighted total + any hard-fail flags to a tier.
 * Any hard-fail flag caps the tier at REJECT regardless of points.
 */
export function tierFor(total: number, flags: string[] = []): Tier {
  if (flags && flags.length > 0) return "REJECT";
  for (const t of TIER_THRESHOLDS) {
    if (total >= t.min) return t.tier;
  }
  return "REJECT";
}

export function tierMeta(tier: Tier) {
  return TIER_THRESHOLDS.find((t) => t.tier === tier)!;
}

/** How many criteria have a non-zero score (for "X/Y scored" UI). */
export function scoredCount(scores: Record<string, number>, criteria: RubricCriterion[]) {
  return criteria.filter((c) => Number(scores[c.key] ?? 0) > 0).length;
}

export function validateRubricWeights(criteria: RubricCriterion[]): boolean {
  const sum = criteria.reduce((a, c) => a + c.weight, 0);
  return Math.abs(sum - 100) < 0.001;
}
