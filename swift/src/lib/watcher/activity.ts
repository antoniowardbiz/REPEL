// Activity-based watcher — the cost-free fallback for platforms we can't read
// directly (X / Instagram / TikTok). It infers the same metrics from signals we
// DO have: the submission links the VA posts via the bot, and how promptly they
// reply to check-ins. "Reported activity" rather than silent observation, but it
// still produces a defensible 1–10.

import { WatchMetrics } from "../rating";

/**
 * 0–1 score for how naturally posts are spread across the window.
 * Dumping everything in one burst → low; evenly spread → high.
 */
export function spacingScoreFromTimestamps(
  timestamps: number[],
  windowStart: number,
  windowEnd: number
): number {
  const ts = timestamps.filter((t) => t >= windowStart && t <= windowEnd).sort((a, b) => a - b);
  if (ts.length <= 1) return ts.length === 1 ? 0.4 : 0;
  const span = Math.max(1, windowEnd - windowStart);
  // Coefficient of variation of gaps: lower variation = more even spacing.
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return 0.2;
  const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean; // 0 = perfectly even
  const evenness = Math.max(0, 1 - cv / 2);
  // Reward using a good chunk of the window rather than a 5-minute burst.
  const coverage = Math.min(1, (ts[ts.length - 1] - ts[0]) / span);
  return Math.max(0, Math.min(1, 0.5 * evenness + 0.5 * coverage));
}

export function computeActivityMetrics(input: {
  submissionTimestamps: number[];
  inboundMessageTimestamps: number[];
  windowStart: number;
  windowEnd: number;
  targetPosts: number;
  postCountFloor?: number; // e.g. count of submission links recorded in a batch
}): WatchMetrics {
  const { submissionTimestamps, inboundMessageTimestamps, windowStart, windowEnd, targetPosts } = input;
  const posts = Math.max(
    submissionTimestamps.filter((t) => t >= windowStart).length,
    input.postCountFloor ?? 0
  );
  const spacingScore = spacingScoreFromTimestamps(submissionTimestamps, windowStart, windowEnd);
  // Responsiveness: any inbound replies during the window → up to 1.0 (a few replies = engaged).
  const replies = inboundMessageTimestamps.filter((t) => t >= windowStart).length;
  const responsiveness = Math.max(0, Math.min(1, replies / 3));
  return { posts, targetPosts, spacingScore, responsiveness, safetyOk: true };
}
