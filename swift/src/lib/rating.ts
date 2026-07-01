// Turn watcher metrics into a 1–10 trial rating, and project that rating onto
// the role's rubric so the scorecard arrives pre-filled for the operator.

import { RubricCriterion } from "./constants";

export type WatchMetrics = {
  posts: number; // posts/reels observed over the window
  targetPosts: number; // expected over the window (postsPerDay × days)
  spacingScore?: number; // 0–1: how naturally spaced (1 = spread out, 0 = dumped)
  responsiveness?: number; // 0–1: replied to bot check-ins / showed work promptly
  removed?: number; // posts removed by mods/spam filters (reddit) — penalty
  safetyOk?: boolean; // false if a likely ban/removal pattern was seen
};

/**
 * Composite 1–10 rating:
 *   volume (0–5) + spacing (0–3) + responsiveness (0–2), minus penalties.
 * 0 means no observed activity (effective no-show).
 */
export function computeRating(m: WatchMetrics): number {
  const volume = Math.max(0, Math.min(1, m.targetPosts > 0 ? m.posts / m.targetPosts : 0));
  const spacing = Math.max(0, Math.min(1, m.spacingScore ?? (m.posts > 1 ? 0.6 : 0)));
  const resp = Math.max(0, Math.min(1, m.responsiveness ?? 0));

  let score = volume * 5 + spacing * 3 + resp * 2;

  // Penalties
  if (m.removed && m.removed > 0) score -= Math.min(3, m.removed); // each removal stings
  if (m.safetyOk === false) score = Math.min(score, 3); // ban-risk caps it low

  return Math.max(0, Math.min(10, Math.round(score)));
}

/** Short human rationale for the auto-draft. */
export function ratingRationale(m: WatchMetrics, rating: number): string {
  const parts = [
    `${m.posts}/${m.targetPosts} posts`,
    m.spacingScore != null ? `spacing ${Math.round(m.spacingScore * 100)}%` : null,
    m.responsiveness != null ? `responsiveness ${Math.round(m.responsiveness * 100)}%` : null,
    m.removed ? `${m.removed} removed` : null,
    m.safetyOk === false ? "⚠ ban-risk pattern" : null,
  ].filter(Boolean);
  return `Auto-rating ${rating}/10 — ${parts.join(", ")}.`;
}

/**
 * Project a 0–10 rating onto every rubric criterion as a 0–5 starting score the
 * operator can then fine-tune. (Safety/ban criteria are pulled down on a flag.)
 */
export function prefillScoresFromRating(
  rating: number,
  criteria: RubricCriterion[],
  safetyOk = true
): Record<string, number> {
  const base = Math.max(0, Math.min(5, Math.round((rating / 10) * 5)));
  const out: Record<string, number> = {};
  for (const c of criteria) {
    const isSafety = /safety|ban|link_safety|account_health|account_safety/i.test(c.key);
    out[c.key] = isSafety && !safetyOk ? Math.min(base, 1) : base;
  }
  return out;
}
