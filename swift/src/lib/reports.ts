// Analytics for the reporting dashboard: hiring funnel, score distribution,
// and time-to-hire. Everything is derived from real entities (candidates,
// trials, scorecards, users) rather than the mutable stage strings, so the
// numbers stay honest even for seeded/imported data that has no stage-change
// history.

import { prisma } from "./db";
import { Tier } from "./constants";

export type FunnelStep = { key: string; label: string; count: number; pct: number };
export type TierCount = { tier: Tier; count: number; pct: number };
export type ScoreBucket = { label: string; min: number; max: number; count: number };
export type RoleStat = {
  roleId: string;
  role: string;
  applied: number;
  submitted: number;
  scored: number;
  avgScore: number | null;
};

export type ReportData = {
  totals: {
    candidates: number;
    applications: number;
    trials: number;
    submitted: number;
    scored: number;
    hires: number;
  };
  funnel: FunnelStep[];
  conversion: {
    applyToTrial: number;
    trialToSubmit: number;
    submitToHire: number;
    overall: number;
  };
  tiers: TierCount[];
  buckets: ScoreBucket[];
  avgScore: number | null;
  avgAutoRating: number | null;
  timing: {
    avgTimeToHireHrs: number | null;
    medianTimeToHireHrs: number | null;
    avgScoringTurnaroundHrs: number | null;
    hiresCounted: number;
  };
  roles: RoleStat[];
};

const HOUR = 3600_000;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export async function getReportData(): Promise<ReportData> {
  const [candidates, applications, trials, scorecards, users, roles] = await Promise.all([
    prisma.candidate.findMany({ select: { id: true, createdAt: true } }),
    prisma.application.findMany({ select: { id: true, roleId: true } }),
    prisma.trial.findMany({ select: { id: true, applicationId: true, submittedAt: true } }),
    prisma.scoreCard.findMany({
      where: { finalized: true },
      select: { trialId: true, tier: true, weightedTotal: true, autoRating: true, scoredAt: true },
    }),
    prisma.user.findMany({
      where: { candidateId: { not: null } },
      select: { candidateId: true, createdAt: true },
    }),
    prisma.role.findMany({ select: { id: true, displayName: true } }),
  ]);

  // Join maps
  const appRole = new Map(applications.map((a) => [a.id, a.roleId]));
  const trialApp = new Map(trials.map((t) => [t.id, t.applicationId]));
  const trialSubmittedAt = new Map(trials.map((t) => [t.id, t.submittedAt]));
  const candCreated = new Map(candidates.map((c) => [c.id, c.createdAt]));

  const submittedTrials = trials.filter((t) => t.submittedAt);

  const totals = {
    candidates: candidates.length,
    applications: applications.length,
    trials: trials.length,
    submitted: submittedTrials.length,
    scored: scorecards.length,
    hires: users.length,
  };

  const denom = totals.candidates || 1;
  const funnel: FunnelStep[] = [
    { key: "applied", label: "Applied", count: totals.candidates, pct: 100 },
    { key: "role", label: "Role selected", count: totals.applications, pct: pct(totals.applications, denom) },
    { key: "trial", label: "Trial started", count: totals.trials, pct: pct(totals.trials, denom) },
    { key: "submitted", label: "Submitted", count: totals.submitted, pct: pct(totals.submitted, denom) },
    { key: "scored", label: "Scored", count: totals.scored, pct: pct(totals.scored, denom) },
    { key: "hired", label: "Hired", count: totals.hires, pct: pct(totals.hires, denom) },
  ];

  const conversion = {
    applyToTrial: pct(totals.trials, totals.candidates),
    trialToSubmit: pct(totals.submitted, totals.trials),
    submitToHire: pct(totals.hires, totals.submitted),
    overall: pct(totals.hires, totals.candidates),
  };

  // Tier outcome distribution
  const tierOrder: Tier[] = ["A", "B", "C", "REJECT"];
  const tierCounts = new Map<string, number>();
  for (const s of scorecards) if (s.tier) tierCounts.set(s.tier, (tierCounts.get(s.tier) ?? 0) + 1);
  const tiers: TierCount[] = tierOrder.map((t) => ({
    tier: t,
    count: tierCounts.get(t) ?? 0,
    pct: pct(tierCounts.get(t) ?? 0, scorecards.length),
  }));

  // Weighted-score histogram (aligned to the tier thresholds)
  const bucketDefs = [
    { label: "REJECT (<50)", min: 0, max: 49.999 },
    { label: "C (50–64)", min: 50, max: 64.999 },
    { label: "B (65–79)", min: 65, max: 79.999 },
    { label: "A (80+)", min: 80, max: 100 },
  ];
  const buckets: ScoreBucket[] = bucketDefs.map((b) => ({
    ...b,
    count: scorecards.filter((s) => s.weightedTotal >= b.min && s.weightedTotal <= b.max).length,
  }));

  const avgScore = avg(scorecards.map((s) => s.weightedTotal));
  const avgAutoRating = avg(
    scorecards.filter((s) => s.autoRating != null).map((s) => s.autoRating as number)
  );

  // Time-to-hire: candidate.createdAt → user.createdAt (a User is created on hire)
  const hireHrs: number[] = [];
  for (const u of users) {
    const created = u.candidateId ? candCreated.get(u.candidateId) : null;
    if (created) hireHrs.push((u.createdAt.getTime() - created.getTime()) / HOUR);
  }
  // Scoring turnaround: trial.submittedAt → scorecard.scoredAt
  const turnHrs: number[] = [];
  for (const s of scorecards) {
    const sub = trialSubmittedAt.get(s.trialId);
    if (sub && s.scoredAt) turnHrs.push((s.scoredAt.getTime() - sub.getTime()) / HOUR);
  }
  const timing = {
    avgTimeToHireHrs: round1(avg(hireHrs)),
    medianTimeToHireHrs: round1(median(hireHrs)),
    avgScoringTurnaroundHrs: round1(avg(turnHrs)),
    hiresCounted: hireHrs.length,
  };

  // Per-role breakdown
  const roleApplied = new Map<string, number>();
  for (const a of applications) roleApplied.set(a.roleId, (roleApplied.get(a.roleId) ?? 0) + 1);
  const roleSubmitted = new Map<string, number>();
  for (const t of submittedTrials) {
    const rid = appRole.get(t.applicationId);
    if (rid) roleSubmitted.set(rid, (roleSubmitted.get(rid) ?? 0) + 1);
  }
  const roleScores = new Map<string, number[]>();
  for (const s of scorecards) {
    const appId = trialApp.get(s.trialId);
    const rid = appId ? appRole.get(appId) : null;
    if (rid) {
      const arr = roleScores.get(rid) ?? [];
      arr.push(s.weightedTotal);
      roleScores.set(rid, arr);
    }
  }
  const rolesStats: RoleStat[] = roles
    .map((r) => ({
      roleId: r.id,
      role: r.displayName,
      applied: roleApplied.get(r.id) ?? 0,
      submitted: roleSubmitted.get(r.id) ?? 0,
      scored: (roleScores.get(r.id) ?? []).length,
      avgScore: round1(avg(roleScores.get(r.id) ?? [])),
    }))
    .sort((a, b) => b.applied - a.applied);

  return {
    totals,
    funnel,
    conversion,
    tiers,
    buckets,
    avgScore: round1(avgScore),
    avgAutoRating: round1(avgAutoRating),
    timing,
    roles: rolesStats,
  };
}
