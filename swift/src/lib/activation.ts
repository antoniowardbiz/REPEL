// Activation drive — get stalled-but-not-yet-hired VAs off the fence and WORKING.
// Win-back only catches trials that already EXPIRED; this catches the bigger,
// earlier bucket the /review page surfaced: people sitting in ROLE_SELECTED /
// TRAINING / TRIAL_READY / TRIAL_ACTIVE who got set up but never started. Each
// gets an escalating, incentive-led nudge PLUS their actual next step re-sent
// (training link or trial brief), with a CTA that hits the bot's real handlers
// so a reply actually moves them forward. Capped + spaced so it never spams.

import { prisma } from "./db";
import { sendTelegramMessage, sendOpsAlert } from "./telegram";
import { firstNameOf } from "./templates";
import { deliverStageMessage } from "./services";

const DAY = 86_400_000;
const HOUR = 3_600_000;

// Tunables (env-overridable).
const MAX = Number(process.env.ACTIVATION_MAX ?? 3); // nudges before we stop
const GAP_DAYS = Number(process.env.ACTIVATION_GAP_DAYS ?? 2); // days between nudges
const LOOKBACK_DAYS = Number(process.env.ACTIVATION_LOOKBACK_DAYS ?? 21); // ignore ancient stalls
const MIN_AGE_HOURS = Number(process.env.ACTIVATION_MIN_AGE_HOURS ?? 8); // don't nudge someone who JUST arrived

// The incentive line. Non-cash + honest by default (queue priority + earning
// sooner), so it's safe to blast. Set ACTIVATION_INCENTIVE to add a bonus, e.g.
// "💵 Plus a $10 bonus on your first pay once you complete your first full day."
const INCENTIVE =
  process.env.ACTIVATION_INCENTIVE ??
  "⚡ The earliest starters this week get first pick of accounts and start earning soonest — don't leave it on the table.";

const PRE_ACTIVE_STAGES = ["ROLE_SELECTED", "TRAINING", "TRIAL_READY", "TRIAL_ACTIVE"];

function composeMessage(stage: string, firstName: string, roleName: string, attempt: number): string {
  const last = attempt >= MAX ? "\n\n(If now's not your moment, no stress — reply whenever you're ready.)" : "";
  if (stage === "ROLE_SELECTED" || stage === "TRAINING") {
    return (
      `Hey ${firstName} — you're SO close to your paid ${roleName} spot 🙌 ` +
      `One quick step left: pass the short training + quiz and you're straight into a paid trial.\n\n` +
      `${INCENTIVE}\n\n` +
      `I've re-sent your training link right below 👇 knock it out today.${last}`
    );
  }
  // TRIAL_READY / TRIAL_ACTIVE — the SUBMIT path hires them on the spot.
  return (
    `Hey ${firstName} — you're all set up and ready to go on your ${roleName} trial 🎯 ` +
    `Fastest way in: post your first piece today and send the link here with the word SUBMIT — ` +
    `strong starts get hired on the spot.\n\n${INCENTIVE}${last}`
  );
}

/**
 * One activation pass. For each stalled pre-active candidate under the attempt
 * cap and past the spacing gap, send the next incentive nudge; on the first
 * nudge also re-deliver their actual next step (training link / brief) so they
 * have everything they need to act. Safe to run daily + on boot.
 */
export async function runActivationDrive(): Promise<{ nudged: number; skipped: number; done: number }> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * DAY);
  const minAgeCut = new Date(Date.now() - MIN_AGE_HOURS * HOUR);

  const candidates = await prisma.candidate.findMany({
    where: {
      archived: false,
      currentStage: { in: PRE_ACTIVE_STAGES },
      createdAt: { gte: cutoff },
      updatedAt: { lt: minAgeCut }, // genuinely stalled, not just-arrived
    },
    include: { currentRole: true, applications: { orderBy: { appliedAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "asc" },
  });

  let nudged = 0;
  let skipped = 0;
  let done = 0;
  const now = Date.now();

  for (const cand of candidates) {
    if (!cand.telegramChatId) {
      skipped++;
      continue;
    }
    // Never chase someone who already converted to a working VA.
    const active = await prisma.assignment.count({
      where: { user: { candidateId: cand.id }, status: { in: ["probation", "active"] } },
    });
    if (active > 0) {
      skipped++;
      continue;
    }

    const prior = await prisma.message.findMany({
      where: {
        candidateId: cand.id,
        direction: "outbound",
        templateKey: { in: ["activation_1", "activation_2", "activation_3"] },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (prior.length >= MAX) {
      done++;
      continue;
    }
    const lastTouch = prior[0]?.createdAt?.getTime() ?? 0;
    if (lastTouch && now - lastTouch < GAP_DAYS * DAY) {
      skipped++;
      continue;
    }

    const attempt = prior.length + 1;
    const roleName = cand.currentRole?.displayName ?? "VA";
    const body = composeMessage(cand.currentStage, firstNameOf(cand.fullName), roleName, attempt);
    const r = await sendTelegramMessage(cand.telegramChatId, body);
    await prisma.message.create({
      data: {
        candidateId: cand.id,
        applicationId: cand.applications[0]?.id ?? null,
        direction: "outbound",
        channel: "telegram",
        templateKey: `activation_${attempt}`,
        body,
        status: r.status,
      },
    });
    // On the FIRST nudge, re-deliver their real next step (training link / brief)
    // so they're not just told to act but handed exactly what to act on.
    if (attempt === 1) {
      await deliverStageMessage(cand.id).catch(() => {});
    }
    nudged++;
  }

  if (nudged > 0) {
    await sendOpsAlert(
      `🚀 Activation drive: nudged ${nudged} stalled VA${nudged === 1 ? "" : "s"} to start (${skipped} skipped, ${done} maxed out).`
    ).catch(() => {});
  }
  return { nudged, skipped, done };
}
