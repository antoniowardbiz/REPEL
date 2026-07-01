// Trial watcher orchestrator. For a given watch it gathers data (Reddit API for
// reddit, activity signals otherwise), records an observation, computes a 1–10
// rating, and lands a (non-finalized) auto-draft scorecard for the operator.

import { prisma } from "../db";
import { parseUrls, parseCriteria } from "../serialize";
import { ROLE_PLATFORM, ROLE_TARGETS } from "../roles-config";
import { computeRating, ratingRationale, prefillScoresFromRating, WatchMetrics } from "../rating";
import { computeActivityMetrics } from "./activity";
import { fetchRedditMetrics } from "./reddit";

const URL_RE = /\bhttps?:\/\/[^\s]+/i;

/** Create (or reuse) a watch for a trial, inferring platform/handle from the role. */
export async function ensureTrialWatch(trialId: string) {
  const existing = await prisma.trialWatch.findUnique({ where: { trialId } });
  if (existing) return existing;
  const trial = await prisma.trial.findUnique({
    where: { id: trialId },
    include: { application: { include: { role: true } } },
  });
  if (!trial) throw new Error("trial not found");
  const roleKey = trial.application.role.key;
  const platform = ROLE_PLATFORM[roleKey] ?? "x";
  const source = platform === "reddit" ? "reddit" : "activity";
  return prisma.trialWatch.create({
    data: {
      trialId,
      platform,
      accountHandle: trial.accountUsed ?? null,
      source,
      status: "active",
      intervalMins: 60,
    },
  });
}

/** Run a single watch: observe → rate → write auto-draft scorecard. */
export async function runTrialWatch(watchId: string) {
  const watch = await prisma.trialWatch.findUnique({
    where: { id: watchId },
    include: {
      trial: {
        include: {
          application: { include: { role: { include: { rubric: true } }, candidate: true } },
        },
      },
    },
  });
  if (!watch) throw new Error("watch not found");
  const trial = watch.trial;
  const role = trial.application.role;
  const roleKey = role.key;

  const windowStart = (trial.startedAt ?? trial.briefSentAt ?? trial.createdAt).getTime();
  const windowEnd = Math.min(Date.now(), (trial.deadlineAt ?? new Date()).getTime() || Date.now());
  const days = Math.max(0.25, (windowEnd - windowStart) / 86_400_000);
  const targetPosts = Math.round((ROLE_TARGETS[roleKey]?.postsPerDay ?? 3) * days);

  // Candidate messages in window → submission timestamps + responsiveness.
  const messages = await prisma.message.findMany({
    where: { candidateId: trial.application.candidateId, createdAt: { gte: new Date(windowStart) } },
    orderBy: { createdAt: "asc" },
  });
  const inbound = messages.filter((m) => m.direction === "inbound");
  const submissionTs = inbound.filter((m) => URL_RE.test(m.body)).map((m) => m.createdAt.getTime());
  const inboundTs = inbound.map((m) => m.createdAt.getTime());
  const urlFloor = parseUrls(trial.submissionUrls).length;
  const responsiveness = Math.max(0, Math.min(1, inboundTs.length / 3));

  // Pick the data source.
  let metrics: WatchMetrics | null = null;
  let usedSource = watch.source;
  if (watch.source === "reddit" && watch.accountHandle) {
    metrics = await fetchRedditMetrics(watch.accountHandle, windowStart, targetPosts, responsiveness);
  }
  if (!metrics) {
    usedSource = watch.source === "reddit" ? "activity_fallback" : "activity";
    metrics = computeActivityMetrics({
      submissionTimestamps: submissionTs,
      inboundMessageTimestamps: inboundTs,
      windowStart,
      windowEnd,
      targetPosts,
      postCountFloor: urlFloor,
    });
  }

  const rating = computeRating(metrics);
  const rationale = ratingRationale(metrics, rating);

  // Record the observation.
  await prisma.trialObservation.create({
    data: {
      watchId: watch.id,
      trialId: trial.id,
      source: usedSource,
      metrics: JSON.stringify(metrics),
      notes: rationale,
    },
  });
  await prisma.activityEvent.create({
    data: {
      candidateId: trial.application.candidateId,
      trialId: trial.id,
      type: "post_observed",
      payload: JSON.stringify({ posts: metrics.posts, rating }),
    },
  });

  // Land / refresh the auto-draft scorecard (never overwrite a finalized one).
  const criteria = parseCriteria(role.rubric?.criteria);
  const prefill = prefillScoresFromRating(rating, criteria, metrics.safetyOk !== false);
  const existing = await prisma.scoreCard.findUnique({ where: { trialId: trial.id } });
  const aiDraft = JSON.stringify({ rating, metrics, scores: prefill, rationale });
  if (!existing) {
    await prisma.scoreCard.create({
      data: {
        trialId: trial.id,
        scores: JSON.stringify(prefill),
        flags: "[]",
        weightedTotal: 0,
        autoRating: rating,
        aiDraft,
        finalized: false,
      },
    });
  } else if (!existing.finalized) {
    await prisma.scoreCard.update({
      where: { trialId: trial.id },
      data: { autoRating: rating, aiDraft },
    });
  }

  await prisma.trialWatch.update({ where: { id: watch.id }, data: { lastCheckedAt: new Date() } });
  return { rating, metrics, source: usedSource };
}

/** Run every active watch that's due (lastCheckedAt older than its interval). */
export async function runDueWatches() {
  const watches = await prisma.trialWatch.findMany({ where: { status: "active" } });
  const now = Date.now();
  const due = watches.filter(
    (w) => !w.lastCheckedAt || now - w.lastCheckedAt.getTime() >= w.intervalMins * 60_000
  );
  const results = [];
  for (const w of due) {
    try {
      const r = await runTrialWatch(w.id);
      results.push({ watchId: w.id, ...r });
    } catch (e: any) {
      const error = String(e?.message ?? e);
      results.push({ watchId: w.id, error });
      // Surface watcher failures to ops instead of swallowing them in a 200.
      await prisma.notification.create({
        data: { type: "watch_error", channel: "ops", payload: JSON.stringify({ watchId: w.id, error }) },
      });
    }
  }
  return results;
}
