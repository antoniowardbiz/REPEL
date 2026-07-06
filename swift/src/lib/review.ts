// The 48-Hour Review — one place that answers "what actually happened": who
// came through, who's stuck and why, what the system said to each VA, and the
// clicks-vs-subs read that tells you whether you have a traffic problem or a
// conversion problem. Pure read layer; the /review page just renders this.

import { prisma } from "./db";
import { ROLE_PLATFORM } from "./roles-config";
import { STAGES, STAGE_META, type Stage } from "./constants";

const HOUR = 3_600_000;

export type ReviewWindow = { hours: number; since: Date };

export type FunnelRow = { stage: Stage; label: string; tone: string; total: number; newIn: number };

export type StartedVa = {
  name: string;
  model: string;
  role: string;
  when: Date;
  status: string;
};

export type StuckVa = {
  name: string;
  model: string | null;
  role: string | null;
  stage: string;
  reason: string; // why they're stuck
  action: string; // what to do about it
  severity: "high" | "med";
  since: Date | null;
};

export type VaActivity = {
  name: string;
  model: string;
  platform: string;
  slot: string;
  hasLink: boolean;
  linkSent: Date | null;
  clicks48: number;
  clicksAll: number;
  subs: number;
  lastActivity: Date | null;
  lastMsgKey: string | null;
  lastMsgAt: Date | null;
};

export type Review = {
  window: ReviewWindow;
  // headline
  verdict: { kind: "conversion" | "traffic" | "flowing" | "empty"; headline: string; detail: string };
  totals: {
    activeVas: number;
    withLink: number;
    missingLink: number;
    clicks48: number;
    clicksAll: number;
    subsAll: number;
    newApplicants48: number;
    hired48: number;
    trialsSubmitted48: number;
    trialsExpired48: number;
  };
  funnel: FunnelRow[];
  started: StartedVa[];
  stuck: StuckVa[];
  vaActivity: VaActivity[];
  systemMessages: { key: string; label: string; count: number }[];
  watcher: { observations48: number; activeWatches: number; postsObserved48: number };
};

const MSG_LABEL: Record<string, string> = {
  personal_link: "Sent their promo link",
  account_handout: "Handed over account login",
  profile_setup: "Told them to set up the profile",
  morning: "Morning check-in nudge",
  role_prompt: "Asked which role + why",
  manager_nudge: "Nudged the stalled account step",
  trial_expired_reengage: "Win-back (trial expired)",
  ai_support: "Answered a question (AI support)",
  human_fallback: "Escalated a question to you",
  hire_holding: "Hire holding (awaiting model)",
};
const msgLabel = (k: string | null) => (k ? MSG_LABEL[k] ?? k : "—");

const PLATFORM_LABEL: Record<string, string> = { x: "X", reddit: "Reddit", instagram: "IG", tiktok: "TikTok" };

export async function build48hReview(hours = 48): Promise<Review> {
  const since = new Date(Date.now() - hours * HOUR);
  const staleCut = new Date(Date.now() - 24 * HOUR); // "not moving" threshold for pre-active stages

  const [
    assignments,
    clicksAllAgg,
    clicks48Agg,
    lastClickAgg,
    sentAgg,
    stageGroups,
    newCandidates,
    hiredAssignments,
    submittedTrials48,
    expiredTrials48,
    stalledCandidates,
    openFlags,
    outboundMsgs,
    msgTypeAgg,
    observations48,
    activeWatches,
    postObserved48,
  ] = await Promise.all([
    prisma.assignment.findMany({
      where: { status: { in: ["probation", "active"] } },
      include: { user: { include: { fromCandidate: true } }, creator: true, role: true },
    }),
    prisma.activityEvent.groupBy({ by: ["userId"], where: { type: "promo_click", userId: { not: null } }, _count: { _all: true } }),
    prisma.activityEvent.groupBy({
      by: ["userId"],
      where: { type: "promo_click", userId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.activityEvent.groupBy({ by: ["userId"], where: { type: "promo_click", userId: { not: null } }, _max: { createdAt: true } }),
    prisma.message.groupBy({ by: ["candidateId"], where: { templateKey: "personal_link" }, _max: { createdAt: true } }),
    prisma.candidate.groupBy({ by: ["currentStage"], where: { archived: false }, _count: { _all: true } }),
    prisma.candidate.count({ where: { createdAt: { gte: since }, archived: false } }),
    prisma.assignment.findMany({
      where: { createdAt: { gte: since } },
      include: { user: true, creator: true, role: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.trial.count({ where: { submittedAt: { gte: since } } }),
    prisma.trial.count({ where: { status: "expired", updatedAt: { gte: since } } }),
    // Pre-active candidates that haven't moved in >24h (excluding terminal stages).
    prisma.candidate.findMany({
      where: {
        archived: false,
        updatedAt: { lt: staleCut },
        currentStage: { notIn: ["ACTIVE", "ARCHIVED", "REJECTED"] },
      },
      include: { currentRole: true },
      orderBy: { updatedAt: "asc" },
      take: 40,
    }),
    prisma.opsFlag.findMany({ where: { status: "open" }, include: { candidate: true }, orderBy: { createdAt: "desc" }, take: 40 }),
    // Latest system message per active VA, within the window — "what it said to them".
    prisma.message.findMany({
      where: { direction: "outbound", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { candidateId: true, templateKey: true, createdAt: true },
    }),
    prisma.message.groupBy({
      by: ["templateKey"],
      where: { direction: "outbound", createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.trialObservation.count({ where: { capturedAt: { gte: since } } }),
    prisma.trialWatch.count({ where: { status: "active" } }),
    prisma.activityEvent.count({ where: { type: "post_observed", createdAt: { gte: since } } }),
  ]);

  const clicksAllBy = new Map(clicksAllAgg.map((c) => [c.userId as string, c._count._all]));
  const clicks48By = new Map(clicks48Agg.map((c) => [c.userId as string, c._count._all]));
  const lastClickBy = new Map(lastClickAgg.map((c) => [c.userId as string, c._max.createdAt as Date | null]));
  const sentBy = new Map(sentAgg.map((m) => [m.candidateId as string, m._max.createdAt as Date | null]));

  // First (latest) outbound message per candidate in the window.
  const lastMsgBy = new Map<string, { key: string | null; at: Date }>();
  for (const m of outboundMsgs) {
    if (!m.candidateId || lastMsgBy.has(m.candidateId)) continue;
    lastMsgBy.set(m.candidateId, { key: m.templateKey, at: m.createdAt });
  }

  // ── Per-VA activity rows ───────────────────────────────────────────────────
  const vaActivity: VaActivity[] = assignments
    .map((a) => {
      const platform = ROLE_PLATFORM[a.role.key] ?? "";
      const platLabel = PLATFORM_LABEL[platform] ?? platform;
      const candId = a.user.candidateId ?? a.user.fromCandidate?.id ?? null;
      const lm = candId ? lastMsgBy.get(candId) : undefined;
      return {
        name: a.user.name,
        model: a.creator.name,
        platform: platLabel,
        slot: a.trialLinkLabel || `${a.creator.name.toUpperCase()}·${(platLabel || "?").toUpperCase()}`,
        hasLink: Boolean(a.promoLink),
        linkSent: candId ? sentBy.get(candId) ?? null : null,
        clicks48: clicks48By.get(a.userId) ?? 0,
        clicksAll: clicksAllBy.get(a.userId) ?? 0,
        subs: a.subs ?? 0,
        lastActivity: lastClickBy.get(a.userId) ?? a.lastActiveDay ?? null,
        lastMsgKey: lm?.key ?? null,
        lastMsgAt: lm?.at ?? null,
      };
    })
    .sort((x, y) => y.subs - x.subs || y.clicks48 - x.clicks48 || x.name.localeCompare(y.name));

  // ── Totals + headline verdict ──────────────────────────────────────────────
  const clicks48 = vaActivity.reduce((s, r) => s + r.clicks48, 0);
  const clicksAll = vaActivity.reduce((s, r) => s + r.clicksAll, 0);
  const subsAll = vaActivity.reduce((s, r) => s + r.subs, 0);
  const withLink = vaActivity.filter((r) => r.hasLink).length;
  const missingLink = vaActivity.filter((r) => !r.hasLink).length;

  let verdict: Review["verdict"];
  if (subsAll > 0) {
    verdict = {
      kind: "flowing",
      headline: `Subs are converting — ${subsAll} total.`,
      detail: "Traffic is reaching the free trial and converting. Keep VAs posting and topping the pool.",
    };
  } else if (clicksAll > 0) {
    verdict = {
      kind: "conversion",
      headline: "Traffic arrived but converted to ZERO — a link/conversion problem, not your VAs.",
      detail:
        `${clicksAll} clicks were logged but 0 subs. Until the fix just shipped, every /go link sent people to the ` +
        `PAID page instead of the free trial, so traffic bounced. Re-check after this deploy + a fresh incognito test.`,
    };
  } else if (withLink > 0) {
    verdict = {
      kind: "traffic",
      headline: "No clicks logged — a traffic problem: VAs aren't posting their tracked links.",
      detail:
        "Links exist but nobody's clicking them, which means VAs aren't posting their /go link (or are posting a raw OF " +
        "link that isn't tracked). Check the 'Sent' column and that VAs know to post THEIR link in bio + comments.",
    };
  } else {
    verdict = {
      kind: "empty",
      headline: "No active VAs with links yet — nothing to convert.",
      detail: "Get VAs through onboarding and their tracked links generated before expecting subs.",
    };
  }

  // ── Funnel ─────────────────────────────────────────────────────────────────
  const stageCount = new Map(stageGroups.map((g) => [g.currentStage, g._count._all]));
  const funnel: FunnelRow[] = STAGES.filter((s) => !["ARCHIVED", "REJECTED"].includes(s)).map((s) => ({
    stage: s,
    label: STAGE_META[s].label,
    tone: STAGE_META[s].tone,
    total: stageCount.get(s) ?? 0,
    newIn: 0, // per-stage new-in-window is approximated by newApplicants48 at the top of funnel
  }));

  // ── Started (hired) in the window ──────────────────────────────────────────
  const started: StartedVa[] = hiredAssignments.map((a) => ({
    name: a.user.name,
    model: a.creator.name,
    role: a.role.displayName,
    when: a.createdAt,
    status: a.status,
  }));

  // ── Stuck VAs (stalled pipeline + open ops flags) ──────────────────────────
  const stuck: StuckVa[] = [];
  // Active VAs with a structural gap (no link, link never sent, or dead).
  for (const r of vaActivity) {
    if (!r.hasLink) {
      stuck.push({
        name: r.name, model: r.model, role: r.platform, stage: "ACTIVE",
        reason: "Active but has NO tracked promo link", action: "Backfill promo links on /vas (auto on deploy too)",
        severity: "high", since: null,
      });
    } else if (!r.linkSent) {
      stuck.push({
        name: r.name, model: r.model, role: r.platform, stage: "ACTIVE",
        reason: "Has a link but it was never sent to them", action: "Hit 'Send links' on /vas — they can't post what they never got",
        severity: "high", since: null,
      });
    } else if (r.clicksAll === 0) {
      stuck.push({
        name: r.name, model: r.model, role: r.platform, stage: "ACTIVE",
        reason: "Link sent but 0 clicks ever — not posting it (or posting untracked)", action: "Coach: post THEIR /go link in bio + every post's comments",
        severity: "med", since: null,
      });
    }
  }
  // Pre-active candidates that haven't moved in >24h.
  for (const c of stalledCandidates) {
    stuck.push({
      name: c.fullName,
      model: null,
      role: c.currentRole?.displayName ?? null,
      stage: c.currentStage,
      reason: `Stuck in ${STAGE_META[c.currentStage as Stage]?.label ?? c.currentStage} — no movement in 24h+`,
      action:
        c.currentStage === "APPLIED" ? "No role/why yet — nudge or archive"
        : c.currentStage === "TRAINING" ? "Hasn't passed the quiz — remind them of the training link"
        : c.currentStage === "TRIAL_ACTIVE" ? "Trial running but nothing submitted — send the 2h nudge"
        : c.currentStage === "SUBMITTED" || c.currentStage === "SCORING" ? "Sitting in scoring — auto-clear should hire; check the scorer job"
        : "Nudge to the next step",
      severity: c.currentStage === "TRIAL_ACTIVE" ? "high" : "med",
      since: c.updatedAt,
    });
  }
  // Open ops flags (VA told the bot something's wrong).
  for (const f of openFlags) {
    stuck.push({
      name: f.candidate.fullName,
      model: null,
      role: null,
      stage: "FLAG",
      reason: f.kind === "account_issue" ? `Reported an account problem${f.note ? `: "${f.note.slice(0, 60)}"` : ""}` : `Ran low on content${f.note ? `: "${f.note.slice(0, 60)}"` : ""}`,
      action: f.kind === "account_issue" ? "Check the account / hand a replacement" : "Top up their content drive",
      severity: "high",
      since: f.createdAt,
    });
  }
  stuck.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));

  // ── System messages breakdown (what the machine said, in the window) ───────
  const systemMessages = msgTypeAgg
    .map((g) => ({ key: g.templateKey ?? "other", label: msgLabel(g.templateKey), count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  return {
    window: { hours, since },
    verdict,
    totals: {
      activeVas: vaActivity.length,
      withLink,
      missingLink,
      clicks48,
      clicksAll,
      subsAll,
      newApplicants48: newCandidates,
      hired48: hiredAssignments.length,
      trialsSubmitted48: submittedTrials48,
      trialsExpired48: expiredTrials48,
    },
    funnel,
    started,
    stuck,
    vaActivity,
    systemMessages,
    watcher: { observations48, activeWatches, postsObserved48: postObserved48 },
  };
}
