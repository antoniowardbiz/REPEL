// Orchestration layer: stage transitions + their automations, message sending,
// trial submission, and score finalization. Shared by API routes and the
// Telegram webhook so behaviour is identical wherever it's triggered.

import { prisma } from "./db";
import { Stage } from "./constants";
import { automationOnEnter } from "./stages";
import { renderTemplate, firstNameOf, MergeContext } from "./templates";
import { sendTelegramMessage, sendOpsAlert } from "./telegram";
import { computeWeightedTotal, tierFor } from "./scoring";
import { RubricCriterion } from "./constants";
import { routeToFolderForStage } from "./folders";
import { ensureTrialWatch } from "./watcher";
import { assignVa } from "./distribution";
import { resolveOpenRoleId } from "./capacity";
import { ROLE_PAY, ROLE_TARGETS } from "./roles-config";
import { randomBytes } from "crypto";

export const genStartToken = () => randomBytes(9).toString("hex");

// Mass-hire mode: when on (default), everyone who SUBMITS their trial is hired
// on the spot — no score gate, no rejections. The scorecard is still recorded
// so weak performers can be flagged for training, but it never blocks the hire.
// Set AUTO_HIRE=0 to fall back to the classic score-gated flow.
export const AUTO_HIRE = (process.env.AUTO_HIRE ?? "1") !== "0";

// Stages that mean the candidate is already hired (so scoring is informational).
const HIRED_STAGES = ["ONBOARDING", "ACTIVE"] as const;
const isHiredStage = (s: string) => (HIRED_STAGES as readonly string[]).includes(s);

/** Public training-page link for a candidate's deep-link token (empty if none). */
function trainingLink(token?: string | null): string {
  if (!token) return "";
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/training/${token}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export async function auditLog(action: string, entity: string, entityId: string, meta?: any, actorUserId?: string) {
  await prisma.auditLog.create({
    data: { action, entity, entityId, meta: meta ? JSON.stringify(meta) : null, actorUserId: actorUserId ?? null },
  });
}

type Category =
  | "first_touch"
  | "brief"
  | "offer"
  | "retrial"
  | "decline"
  | "training"
  | "onboarding"
  | "other";

async function resolveTemplate(category: Category, roleId?: string | null) {
  // Prefer a role-specific template, then a generic (roleId null) one.
  if (roleId) {
    const roleSpecific = await prisma.messageTemplate.findFirst({
      where: { category, roleId, active: true },
    });
    if (roleSpecific) return roleSpecific;
  }
  return prisma.messageTemplate.findFirst({ where: { category, roleId: null, active: true } });
}

async function buildMergeContext(applicationId: string, extra?: Partial<MergeContext>): Promise<MergeContext> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { candidate: true, role: { include: { defaultCreator: true, manager: true } } },
  });
  if (!app) throw new Error("application not found");

  // Use the candidate's ACTUAL assigned model when one exists (set at hire) —
  // the role default is only the pre-hire fallback. Without this, a hire
  // assigned to Lae could be told they're running Lola.
  const assignment = await prisma.assignment.findFirst({
    where: { user: { candidateId: app.candidateId }, status: { in: ["probation", "active"] } },
    orderBy: { createdAt: "desc" },
    include: { creator: true },
  });
  const creator = assignment?.creator ?? app.role.defaultCreator;

  // Their team group: the qualified group for (role, model) when assigned,
  // falling back to the role's training group.
  let groupInvite = "";
  if (assignment) {
    const grp = await prisma.telegramGroup.findFirst({
      where: { roleId: app.roleId, creatorId: assignment.creatorId, kind: "qualified", active: true },
    });
    groupInvite = grp?.inviteUrl ?? "";
  }

  return {
    first_name: firstNameOf(app.candidate.fullName),
    model_name: creator?.name ?? "the model",
    model_main_url: creator?.xMainUrl ?? "",
    content_drive_url: creator?.contentDriveUrl ?? "",
    training_group_url: app.role.trainingGroupUrl ?? "",
    training_url: trainingLink(app.candidate.startToken),
    trial_hours: app.role.trialHours,
    role_name: app.role.displayName,
    manager_name: app.role.manager?.name ?? "",
    daily_target: ROLE_TARGETS[app.role.key]?.label ?? "",
    pay_line: ROLE_PAY[app.role.key] ?? "",
    group_invite_url: groupInvite || app.role.trainingGroupUrl || "",
    ...extra,
  };
}

/** Render + send a templated message to the candidate, recording it. */
export async function sendTemplatedMessage(
  applicationId: string,
  category: Category,
  extra?: Partial<MergeContext>
) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { candidate: true, role: true },
  });
  if (!app) throw new Error("application not found");

  const template = await resolveTemplate(category, app.roleId);
  if (!template) {
    return { skipped: true as const, reason: `no ${category} template` };
  }
  const ctx = await buildMergeContext(applicationId, extra);
  let body = renderTemplate(template.body, ctx);

  // Training gate: if this role has a quiz and the template didn't already
  // include the link, append the training CTA so the candidate can unlock the
  // trial by passing.
  if (category === "training" && app.candidate.startToken) {
    const mod = await prisma.trainingModule.findUnique({ where: { roleId: app.roleId } });
    if (mod && !body.includes("/training/")) {
      body += `\n\n📚 Complete your training + quiz to unlock your trial:\n${trainingLink(
        app.candidate.startToken
      )}`;
    }
  }

  const result = await sendTelegramMessage(app.candidate.telegramChatId, body);

  const message = await prisma.message.create({
    data: {
      candidateId: app.candidateId,
      applicationId,
      direction: "outbound",
      channel: "telegram",
      templateKey: template.key,
      body,
      status: result.status,
      meta: result.detail ? JSON.stringify({ detail: result.detail }) : null,
    },
  });
  return { skipped: false as const, message, sendStatus: result.status };
}

/** Send the first-touch ("which role + why") message — used at intake. */
export async function sendFirstTouch(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new Error("candidate not found");
  const template = await prisma.messageTemplate.findFirst({
    where: { category: "first_touch", active: true },
  });
  if (!template) return { skipped: true as const };
  const body = renderTemplate(template.body, { first_name: firstNameOf(candidate.fullName) });
  const result = await sendTelegramMessage(candidate.telegramChatId, body);
  const message = await prisma.message.create({
    data: {
      candidateId,
      direction: "outbound",
      channel: "telegram",
      templateKey: template.key,
      body,
      status: result.status,
    },
  });
  return { skipped: false as const, message };
}

/**
 * Deliver whatever message is appropriate for a candidate's CURRENT stage.
 * Used when the bot first gets a chat id (via /start or first DM) so the
 * previously-"simulated" auto-reply actually reaches them.
 */
export async function deliverStageMessage(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { applications: { orderBy: { appliedAt: "desc" }, take: 1 } },
  });
  if (!candidate) return { skipped: true as const };
  const app = candidate.applications[0];
  const stage = (app?.stage ?? candidate.currentStage) as Stage;
  if (!app || stage === "APPLIED") return sendFirstTouch(candidateId);
  if (stage === "ROLE_SELECTED" || stage === "TRAINING") return sendTemplatedMessage(app.id, "training");
  if (stage === "TRIAL_READY" || stage === "TRIAL_ACTIVE") return sendTemplatedMessage(app.id, "brief");
  return { skipped: true as const };
}

// ── Stage transitions + automations ──────────────────────────────────────────

export async function moveStage(applicationId: string, to: Stage, actorUserId?: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { role: true, trials: true },
  });
  if (!app) throw new Error("application not found");
  const from = app.stage as Stage;

  await prisma.application.update({
    where: { id: applicationId },
    data: { stage: to, stageChangedAt: new Date() },
  });
  await prisma.candidate.update({
    where: { id: app.candidateId },
    data: { currentStage: to, currentRoleId: app.roleId },
  });
  await auditLog("stage_change", "Application", applicationId, { from, to }, actorUserId);

  const automation = automationOnEnter(to);
  const effects: string[] = [];

  if (automation?.kind === "send_template" && automation.category === "training") {
    const r = await sendTemplatedMessage(applicationId, "training");
    if (!r.skipped) effects.push(`training message ${r.sendStatus}`);
  }

  if (automation?.kind === "create_trial_and_brief") {
    // Create the trial (idempotent: reuse a not_started one if present)
    const role = app.role;
    let trial = app.trials.find((t) => t.status === "not_started") ?? null;
    const deadline = new Date(Date.now() + role.trialHours * 3600_000);
    if (!trial) {
      trial = await prisma.trial.create({
        data: {
          applicationId,
          creatorId: role.defaultCreatorId,
          contentDriveUrl: null,
          briefSentAt: new Date(),
          startedAt: new Date(),
          deadlineAt: deadline,
          status: "active",
        },
      });
    } else {
      trial = await prisma.trial.update({
        where: { id: trial.id },
        data: { briefSentAt: new Date(), startedAt: new Date(), deadlineAt: deadline, status: "active" },
      });
    }
    const r = await sendTemplatedMessage(applicationId, "brief");
    if (!r.skipped) effects.push(`brief ${r.sendStatus}`);
    effects.push(`trial created (deadline ${deadline.toISOString()})`);
    // Start watching the trial account (Reddit API or activity-based).
    try {
      await ensureTrialWatch(trial.id);
      effects.push("watcher started");
    } catch {
      /* non-fatal */
    }
  }

  if (automation?.kind === "queue_for_scoring") {
    await prisma.notification.create({
      data: { type: "trial_submitted", channel: "ops", payload: JSON.stringify({ applicationId }) },
    });
    const cand = await prisma.candidate.findUnique({ where: { id: app.candidateId } });
    await sendOpsAlert(`📥 Trial submitted: ${cand?.fullName ?? app.candidateId} (${app.role.displayName}) — ready to score.`);
    effects.push("queued for scoring");
  }

  // On hire: create the User (if needed), auto-distribute to a model, and route
  // into that model's qualified folder. Never let a missing model break the move.
  if (to === "ONBOARDING") {
    try {
      const hire = await onboardHire(applicationId);
      if (hire.creatorName) effects.push(`assigned to ${hire.creatorName}`);
    } catch (e: any) {
      effects.push(`onboarding needs attention: ${e?.message ?? "auto-assign failed"}`);
      await sendOpsAlert(
        `⚠ Hired candidate ${app.candidateId} but couldn't auto-assign a model (${e?.message ?? "no active model"}). Assign manually.`
      );
    }
  }

  // Folder routing for the destination stage (trial group vs qualified group).
  try {
    const assignment = await prisma.assignment.findFirst({
      where: { user: { candidateId: app.candidateId } },
      orderBy: { createdAt: "desc" },
    });
    const folder = await routeToFolderForStage(app.candidateId, app.roleId, to, assignment?.creatorId ?? null);
    if (!folder.skipped) effects.push(`moved to folder: ${folder.folder?.label ?? "?"}`);
  } catch {
    /* non-fatal */
  }

  return { from, to, effects };
}

/** Turn a hired candidate into a User and assign them to a model (auto-balanced). */
export async function onboardHire(applicationId: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { candidate: true, role: true },
  });
  if (!app) throw new Error("application not found");

  // Reuse an existing User for this candidate, or create one.
  let user = await prisma.user.findFirst({ where: { candidateId: app.candidateId } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: app.candidate.fullName,
        role: "va",
        telegramHandle: app.candidate.telegramHandle,
        email: app.candidate.email,
        candidateId: app.candidateId,
        status: "active",
      },
    });
  }
  // Avoid duplicate assignment.
  const existing = await prisma.assignment.findFirst({
    where: { userId: user.id, roleId: app.roleId, status: { in: ["probation", "active"] } },
  });
  if (existing) {
    const creator = await prisma.creator.findUnique({ where: { id: existing.creatorId } });
    return { userId: user.id, assignmentId: existing.id, creatorName: creator?.name };
  }
  const assignment = await assignVa({
    userId: user.id,
    roleId: app.roleId,
    managerUserId: app.role.managerUserId,
  });
  const creator = await prisma.creator.findUnique({ where: { id: assignment.creatorId } });
  await auditLog("hired", "User", user.id, { applicationId, creator: creator?.name });
  return { userId: user.id, assignmentId: assignment.id, creatorName: creator?.name };
}

// ── Trial submission ─────────────────────────────────────────────────────────

export async function submitTrial(
  applicationId: string,
  submissionUrls: string[],
  accountUsed?: string,
  actorUserId?: string
) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { trials: true },
  });
  if (!app) throw new Error("application not found");

  // Use the active/most recent trial, or create one.
  let trial =
    app.trials.find((t) => t.status === "active") ??
    app.trials.sort((a, b) => +b.createdAt - +a.createdAt)[0] ??
    null;
  if (!trial) {
    trial = await prisma.trial.create({ data: { applicationId, status: "active" } });
  }

  trial = await prisma.trial.update({
    where: { id: trial.id },
    data: {
      submissionUrls: JSON.stringify(submissionUrls),
      accountUsed: accountUsed ?? trial.accountUsed,
      submittedAt: new Date(),
      status: "submitted",
    },
  });

  // Ensure a (draft) scorecard exists for the scorer queue.
  await prisma.scoreCard.upsert({
    where: { trialId: trial.id },
    update: {},
    create: { trialId: trial.id, scores: "{}", flags: "[]", weightedTotal: 0, finalized: false },
  });

  await auditLog("trial_submitted", "Trial", trial.id, { submissionUrls }, actorUserId);

  // Idempotency guard: if this application is already hired or closed out, just
  // record the submission (above) and stop — never re-run the pipeline. Without
  // this, a repeat POST/submit on an ACTIVE auto-hire would demote them
  // (ACTIVE→SUBMITTED→…→ACTIVE), re-queue scoring, and DM a second offer.
  const stage = app.stage as Stage;
  if (isHiredStage(stage) || stage === "ARCHIVED" || stage === "REJECTED") {
    await auditLog("resubmission_ignored", "Application", applicationId, { stage }, actorUserId);
    return trial;
  }

  await moveStage(applicationId, "SUBMITTED", actorUserId);

  // Mass-hire: submitting the trial IS the hire. Onboard immediately, send the
  // offer, and go ACTIVE — regardless of score. Scoring still happens (for
  // training triage) but is no longer a gate. Never let a hiccup here block the
  // record of the submission.
  if (AUTO_HIRE) {
    try {
      await moveStage(applicationId, "ONBOARDING", actorUserId); // creates User + auto-assigns a model
      await sendTemplatedMessage(applicationId, "offer");
      await moveStage(applicationId, "ACTIVE", actorUserId);
      // Full setup message — their model, drive, daily target, pay, group. Sent
      // after ONBOARDING so the merge context sees the real assignment.
      await sendTemplatedMessage(applicationId, "onboarding");
      await auditLog("auto_hired", "Application", applicationId, { reason: "mass_hire_on_submit" }, actorUserId);
      const cand = await prisma.candidate.findUnique({ where: { id: app.candidateId } });
      await sendOpsAlert(`✅ Auto-hired ${cand?.fullName ?? app.candidateId} (${app.roleId}) on trial submission.`);
    } catch (e: any) {
      await sendOpsAlert(
        `⚠ Auto-hire hit a snag for application ${applicationId} (${e?.message ?? "unknown"}). They submitted — finish onboarding manually.`
      );
    }
  }

  return trial;
}

// ── Score finalization ───────────────────────────────────────────────────────

export type FinalizeInput = {
  scores: Record<string, number>;
  flags?: string[];
  rationale?: string;
  scorerUserId?: string;
  autoSendOutcome?: boolean;
};

export async function finalizeScoreCard(trialId: string, input: FinalizeInput) {
  const trial = await prisma.trial.findUnique({
    where: { id: trialId },
    include: { application: { include: { role: { include: { rubric: true } } } } },
  });
  if (!trial) throw new Error("trial not found");
  const rubric = trial.application.role.rubric;
  const criteria: RubricCriterion[] = rubric ? JSON.parse(rubric.criteria) : [];

  // Scoring is a quality/training signal only — never demote or decline — when
  // the candidate is already hired OR when mass-hire mode is on. The AUTO_HIRE
  // check also covers the failure path where an auto-hire hiccup parked the app
  // at SUBMITTED: without it, a later low score would DM a decline to someone
  // mass-hire meant to keep.
  const alreadyHired = isHiredStage(trial.application.stage) || AUTO_HIRE;

  const flags = input.flags ?? [];
  const total = computeWeightedTotal(input.scores, criteria);
  const tier = tierFor(total, flags);

  const card = await prisma.scoreCard.upsert({
    where: { trialId },
    update: {
      scorerUserId: input.scorerUserId ?? null,
      scores: JSON.stringify(input.scores),
      flags: JSON.stringify(flags),
      weightedTotal: total,
      tier,
      rationale: input.rationale ?? null,
      finalized: true,
      scoredAt: new Date(),
    },
    create: {
      trialId,
      scorerUserId: input.scorerUserId ?? null,
      scores: JSON.stringify(input.scores),
      flags: JSON.stringify(flags),
      weightedTotal: total,
      tier,
      rationale: input.rationale ?? null,
      finalized: true,
      scoredAt: new Date(),
    },
  });

  await auditLog("score_finalized", "ScoreCard", card.id, { total, tier, flags, alreadyHired }, input.scorerUserId);

  // Already-hired (mass-hire): keep them where they are. Low tier just means
  // "needs training" — surface it to ops instead of declining anyone.
  if (alreadyHired) {
    if (tier === "C" || tier === "REJECT") {
      await sendOpsAlert(
        `📚 Quality flag: ${trial.application.role.displayName} hire scored ${total} (${tier}). Queue them for extra training.`
      );
    }
    return { card, total, tier, outcome: null as null, alreadyHired: true };
  }

  await moveStage(trial.applicationId, "DECISION", input.scorerUserId);

  // Fire the outcome template (offer / re-trial / decline) per tier.
  let outcome: { category: "offer" | "retrial" | "decline"; sendStatus?: string } | null = null;
  if (input.autoSendOutcome) {
    const category = tier === "A" || tier === "B" ? "offer" : tier === "C" ? "retrial" : "decline";
    let extra: Partial<MergeContext> = {};
    if (category === "retrial") {
      // Build feedback from the weakest criteria.
      const weak = criteria
        .filter((c) => Number(input.scores[c.key] ?? 0) <= 2)
        .map((c) => `• ${c.label}: aim for — ${c.anchor_5}`)
        .slice(0, 4)
        .join("\n");
      extra.feedback = weak || "• Tighten up consistency and follow the brief closely.";
    }
    const r = await sendTemplatedMessage(trial.applicationId, category, extra);
    outcome = { category, sendStatus: r.skipped ? undefined : r.sendStatus };
  }

  return { card, total, tier, outcome, alreadyHired: false };
}

// ── Candidate intake ─────────────────────────────────────────────────────────

export async function intakeCandidate(input: {
  fullName: string;
  telegramHandle?: string;
  email?: string;
  country?: string;
  timezone?: string;
  roleKey?: string | null;
  whyText?: string | null;
  source?: string;
}) {
  let roleId: string | null = null;
  let steeredNote: { from: string | null; to: string | null } | null = null;
  if (input.roleKey) {
    const role = await prisma.role.findUnique({ where: { key: input.roleKey } });
    // Capacity steering: honour their pick if it's open, otherwise push them to
    // the role that needs people most (their pick was full).
    const resolved = await resolveOpenRoleId(role?.id ?? null);
    roleId = resolved.roleId ?? role?.id ?? null;
    if (resolved.steered) steeredNote = { from: resolved.from, to: resolved.to };
  }

  const startToken = genStartToken();
  const candidate = await prisma.candidate.create({
    data: {
      fullName: input.fullName,
      telegramHandle: input.telegramHandle || null,
      email: input.email || null,
      country: input.country || null,
      timezone: input.timezone || null,
      source: input.source || "onlinejobs_ph",
      whyText: input.whyText || null,
      currentRoleId: roleId,
      currentStage: roleId ? "ROLE_SELECTED" : "APPLIED",
      startToken,
    },
  });
  await auditLog("candidate_created", "Candidate", candidate.id, { source: candidate.source });

  if (roleId) {
    const application = await prisma.application.create({
      data: { candidateId: candidate.id, roleId, whyText: input.whyText || null, stage: "ROLE_SELECTED" },
    });
    if (steeredNote) {
      await auditLog("role_steered", "Application", application.id, steeredNote);
      await sendOpsAlert(
        `↪ Steered new applicant to ${steeredNote.to} (picked ${steeredNote.from ?? "—"}, which is full).`
      );
    }
    // Fire the ROLE_SELECTED automation (training message).
    await moveStage(application.id, "ROLE_SELECTED");
    return { candidate, applicationId: application.id, steered: steeredNote };
  } else {
    await sendFirstTouch(candidate.id);
    return { candidate, applicationId: null };
  }
}

/** Select a role for an existing candidate (creates the application + fires training). */
export async function selectRole(candidateId: string, roleKey: string, whyText?: string) {
  const role = await prisma.role.findUnique({ where: { key: roleKey } });
  if (!role) throw new Error("role not found");

  // Capacity steering: honour the pick if open, else push to the neediest role.
  const resolved = await resolveOpenRoleId(role.id);
  const finalRoleId = resolved.roleId ?? role.id;

  const application = await prisma.application.create({
    data: { candidateId, roleId: finalRoleId, whyText: whyText || null, stage: "ROLE_SELECTED" },
  });
  await prisma.candidate.update({
    where: { id: candidateId },
    data: { currentRoleId: finalRoleId, whyText: whyText || undefined },
  });
  if (resolved.steered) {
    await auditLog("role_steered", "Application", application.id, { from: resolved.from, to: resolved.to });
    await sendOpsAlert(`↪ Steered ${role.displayName} pick to ${resolved.to} (picked role is full).`);
  }
  await moveStage(application.id, "ROLE_SELECTED");
  return application;
}
