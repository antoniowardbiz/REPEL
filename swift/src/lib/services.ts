// Orchestration layer: stage transitions + their automations, message sending,
// trial submission, and score finalization. Shared by API routes and the
// Telegram webhook so behaviour is identical wherever it's triggered.

import { prisma } from "./db";
import { Stage } from "./constants";
import { automationOnEnter } from "./stages";
import { renderTemplate, firstNameOf, MergeContext } from "./templates";
import { sendTelegramMessage, sendOpsAlert, telegramConfigured } from "./telegram";
import { computeWeightedTotal, tierFor } from "./scoring";
import { RubricCriterion } from "./constants";
import { routeToFolderForStage } from "./folders";
import { ensureTrialWatch } from "./watcher";
import { assignVa } from "./distribution";
import { resolveOpenRoleId } from "./capacity";
import { ROLE_PAY, ROLE_TARGETS, ROLE_TRIAL_CONTENT, ROLE_PLATFORM, CREATORS } from "./roles-config";
import { claimNextAccount } from "./accounts";
import { claimTrialLink } from "./trial-links";
import { followExamplesBlock } from "./follow-config";
import { PLAYBOOKS } from "./playbooks-config";
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
  | "account_check"
  | "account_ready"
  | "account_setup"
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

  // Per-role drive when set (Lola's X folder ≠ Lola's Reddit folder), falling
  // back to the model's general drive.
  let drive = creator?.contentDriveUrl ?? "";
  try {
    const drives = creator?.contentDrives ? JSON.parse(creator.contentDrives) : {};
    if (drives?.[app.role.key]) drive = drives[app.role.key];
  } catch {
    /* keep fallback */
  }

  // Where the VA must put their promo link, per platform — drilled in from day
  // one so no reach is wasted. X wants it in the bio AND every post's comments;
  // Reddit funnels through the bio (post bodies strip external links).
  const platform = ROLE_PLATFORM[app.role.key];
  const linkPlacement =
    platform === "x"
      ? `📍 Put your link in your X bio AND drop it in the comments of EVERY post — that's how fans find it.`
      : platform === "reddit"
        ? `📍 Put your link in your Reddit bio so it sits on every post you make.`
        : `📍 Keep your link in your bio so fans can always find it.`;

  const manager = app.role.manager;
  const managerLabel = manager
    ? manager.telegramHandle
      ? `${manager.name} (${manager.telegramHandle})`
      : manager.name
    : "";
  // Tappable deep link to the manager's Telegram (from @handle → t.me/handle).
  const managerLink = manager?.telegramHandle
    ? `https://t.me/${manager.telegramHandle.replace(/^@/, "")}`
    : "";

  return {
    first_name: firstNameOf(app.candidate.fullName),
    model_name: creator?.name ?? "the model",
    model_main_url: creator?.xMainUrl ?? "",
    content_drive_url: drive,
    trial_content_url: ROLE_TRIAL_CONTENT[app.role.key] ?? "",
    training_group_url: app.role.trainingGroupUrl ?? "",
    training_url: trainingLink(app.candidate.startToken),
    trial_hours: app.role.trialHours,
    role_name: app.role.displayName,
    manager_name: manager?.name ?? "",
    manager_label: managerLabel,
    manager_handle: manager?.telegramHandle ?? "",
    manager_link: managerLink,
    daily_target: ROLE_TARGETS[app.role.key]?.label ?? "",
    pay_line: app.role.pay ?? ROLE_PAY[app.role.key] ?? "", // live-editable pay (dashboard) → code default fallback
    playbook_url: PLAYBOOKS[app.role.key]
      ? `${(process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "")}/playbook/${app.role.key}`
      : "",
    group_invite_url: groupInvite || app.role.trainingGroupUrl || "",
    promo_link: assignment?.trialLinkUrl || creator?.ofTrialUrl || "", // the VA's RAW OnlyFans free-trial link — they post this directly (no /go wrapper)
    link_placement: assignment ? linkPlacement : "", // only once hired (they have a link to place)
    ...extra,
  };
}

/**
 * Surface an outbound message that did NOT actually reach the candidate. A
 * "failed" send (blocked bot, rate limit, bad chat id) or — in production, where
 * a bot token IS configured — a "simulated" send (candidate never bound their
 * Telegram) otherwise vanishes into a DB field no one watches. Fire an ops alert
 * so a human notices instead of the candidate silently going dark.
 */
async function alertUndelivered(status: string, who: string, label: string) {
  const undelivered = status === "failed" || (status === "simulated" && telegramConfigured());
  if (!undelivered) return;
  await sendOpsAlert(`⚠ "${label}" message NOT delivered to ${who} (${status}). They may be stuck — reach out.`).catch(
    () => {}
  );
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
  await alertUndelivered(result.status, `${app.candidate.fullName} (${category})`, category);
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
  await alertUndelivered(result.status, `${candidate.fullName} (first_touch)`, "first_touch");
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
  if (stage === "TRIAL_READY" || stage === "TRIAL_ACTIVE") {
    // Awaiting the account answer → re-send the question. Already with the
    // manager → nudge them there. Otherwise (X self-serve) → the brief.
    const gate = await prisma.trial.findFirst({
      where: { applicationId: app.id, status: { in: ["account_check", "with_manager"] } },
    });
    if (gate?.status === "account_check") return sendTemplatedMessage(app.id, "account_check");
    if (gate?.status === "with_manager") return { skipped: true as const };
    return sendTemplatedMessage(app.id, "brief");
  }
  // Already hired (ONBOARDING/ACTIVE) — this is the case that used to send
  // NOTHING: a VA activated before they'd messaged the bot had their account +
  // link DM'd into a null chat (lost), and then this returned skipped when they
  // finally bound. Re-deliver the full setup so binding = getting everything.
  if (isHiredStage(stage)) {
    await resendActivation(candidateId).catch(() => {});
    return { skipped: false as const };
  }
  return { skipped: true as const };
}

/**
 * Re-deliver a hired VA's full activation — the onboarding message (model, pay,
 * content folder, their tracked link + placement) AND their account login. Fires
 * when an already-ACTIVE VA binds to the bot, and is reusable anywhere a VA needs
 * their setup re-sent. Claims a pool account if they somehow hold none. Every
 * send is guarded so one failure never blocks the rest.
 */
export async function resendActivation(candidateId: string): Promise<{ sent: boolean }> {
  const app = await prisma.application.findFirst({
    where: { candidateId, stage: { in: [...HIRED_STAGES] } },
    orderBy: { stageChangedAt: "desc" },
  });
  if (!app) return { sent: false };
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  const user = await prisma.user.findFirst({ where: { candidateId } });
  const asg = user
    ? await prisma.assignment.findFirst({
        where: { userId: user.id, status: { in: ["probation", "active"] } },
        orderBy: { createdAt: "desc" },
        include: { role: true },
      })
    : null;
  // Ensure their link exists, then send the onboarding message (which carries it).
  if (asg) await ensurePromoLink(asg.id, firstNameOf(candidate?.fullName || "VA")).catch(() => {});
  await sendTemplatedMessage(app.id, "onboarding").catch(() => {});
  // Send their account login — reuse the one they hold, else claim from the pool.
  if (user && asg) {
    const grant = await prisma.accessGrant.findFirst({
      where: { userId: user.id, status: "active", account: { login: { not: null } } },
      orderBy: { grantedAt: "desc" },
    });
    if (grant) {
      await deliverAccountLogin(grant.accountId, user.id).catch(() => {});
    } else {
      const platform = ROLE_PLATFORM[asg.role.key];
      if (platform) {
        const acct = await claimNextAccount({ platform, creatorId: asg.creatorId, userId: user.id }).catch(() => null);
        if (acct) await deliverAccountLogin(acct.id, user.id).catch(() => {});
      }
    }
  }
  return { sent: true };
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
    // Everyone who reaches TRIAL_READY runs a short self-serve trial on any
    // account of their own — it proves they understand the SOP. (Account-managed
    // roles like Reddit no longer reach here: they onboard straight off the quiz
    // and are auto-handed a pool account.) Passing the trial → auto-hire → the
    // system hands them their own pool account.
    const r = await startTrial(applicationId);
    effects.push(...r.effects);
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

/** A Prisma unique-constraint violation (P2002) — a lost concurrency race. */
const isUniqueViolation = (e: any) => e?.code === "P2002";

/**
 * Turn a hired candidate into a User and assign them to a model (auto-balanced).
 *
 * Race-safe: two near-simultaneous hires for the same person (a Telegram retry
 * or a double-tapped SUBMIT) can both pass the "already assigned?" read before
 * either writes. The DB now backs that check with a partial unique index on
 * active (userId, roleId), so the loser's create throws P2002 — which we catch
 * and resolve to the winner's hire instead of creating a duplicate or firing a
 * false "assign manually" alert.
 */
export async function onboardHire(applicationId: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { candidate: true, role: true },
  });
  if (!app) throw new Error("application not found");

  // Reuse an existing User for this candidate, or create one — race-safe on the
  // User.candidateId unique constraint.
  let user = await prisma.user.findFirst({ where: { candidateId: app.candidateId } });
  if (!user) {
    try {
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
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      user = await prisma.user.findFirst({ where: { candidateId: app.candidateId } });
    }
  }
  if (!user) throw new Error("could not resolve user for candidate");

  // Already assigned for this role? Reuse it (the common idempotent path).
  const activeWhere = { userId: user.id, roleId: app.roleId, status: { in: ["probation", "active"] } };
  const existing = await prisma.assignment.findFirst({ where: activeWhere });
  if (existing) {
    const creator = await prisma.creator.findUnique({ where: { id: existing.creatorId } });
    return { userId: user.id, assignmentId: existing.id, creatorName: creator?.name };
  }

  // Create the assignment. If a concurrent hire beat us, the partial unique
  // index throws P2002 — resolve to their assignment instead of duplicating.
  try {
    const assignment = await assignVa({
      userId: user.id,
      roleId: app.roleId,
      managerUserId: app.role.managerUserId,
    });
    const creator = await prisma.creator.findUnique({ where: { id: assignment.creatorId } });
    await auditLog("hired", "User", user.id, { applicationId, creator: creator?.name });
    return { userId: user.id, assignmentId: assignment.id, creatorName: creator?.name };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const won = await prisma.assignment.findFirst({ where: activeWhere });
    if (won) {
      const creator = await prisma.creator.findUnique({ where: { id: won.creatorId } });
      await auditLog("hire_dedup", "User", user.id, { applicationId, note: "concurrent hire resolved to existing assignment" });
      return { userId: user.id, assignmentId: won.id, creatorName: creator?.name };
    }
    throw e;
  }
}

// ── Trial start + account check ──────────────────────────────────────────────

/** Actually start the trial: set the clock, send the trial steps, watch it. */
export async function startTrial(applicationId: string): Promise<{ effects: string[] }> {
  const app = await prisma.application.findUnique({ where: { id: applicationId }, include: { role: true, trials: true } });
  if (!app) throw new Error("application not found");
  const effects: string[] = [];
  const deadline = new Date(Date.now() + app.role.trialHours * 3600_000);
  let trial =
    app.trials.find((t) => ["not_started", "account_check", "needs_account"].includes(t.status)) ?? null;
  if (!trial) {
    trial = await prisma.trial.create({
      data: { applicationId, creatorId: app.role.defaultCreatorId, briefSentAt: new Date(), startedAt: new Date(), deadlineAt: deadline, status: "active" },
    });
  } else {
    trial = await prisma.trial.update({
      where: { id: trial.id },
      data: { briefSentAt: new Date(), startedAt: new Date(), deadlineAt: deadline, status: "active" },
    });
  }
  const r = await sendTemplatedMessage(applicationId, "brief"); // brief = the trial steps (with pass/fail)
  if (!r.skipped) effects.push(`trial steps ${r.sendStatus}`);
  effects.push(`trial started (deadline ${deadline.toISOString()})`);
  try {
    await ensureTrialWatch(trial.id);
    effects.push("watcher started");
  } catch {
    /* non-fatal */
  }
  return { effects };
}

/**
 * Hand a candidate to the role's manager (e.g. Reddit → Haria). The manager
 * assesses the account and assigns the right path — a good account may be ready
 * for full posting, a weak/absent one needs setup + warming — because the trial
 * content depends on the account. Works for both "I have an account" (assess &
 * start) and "I don't" (set up + warm). The manager also gets the candidate's
 * quiz diagnostics so they know what to reinforce.
 */
export async function routeToManagerForAccount(applicationId: string, hasAccount: boolean) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { role: { include: { manager: true, trainingModule: true } }, candidate: true, trials: true },
  });
  if (!app) throw new Error("application not found");
  const trial = app.trials.find((t) => t.status === "account_check" || t.status === "with_manager");
  // Reset the one-time nudge flag on entry to with_manager so the distinct
  // "message your manager" nudge can still fire even if an account_check nudge
  // already went out (they're two different follow-ups, tracked by one flag).
  if (trial)
    await prisma.trial.update({
      where: { id: trial.id },
      data: { status: "with_manager", managerNudgeSent: false },
    });

  await sendTemplatedMessage(applicationId, hasAccount ? "account_ready" : "account_setup");

  // Quiz diagnostics for the manager: score + the topics they got wrong.
  let quizNote = "";
  const attempt = await prisma.quizAttempt.findFirst({
    where: { candidateId: app.candidateId },
    orderBy: { createdAt: "desc" },
  });
  if (attempt && app.role.trainingModule) {
    try {
      const qs = JSON.parse(app.role.trainingModule.questions) as { prompt: string; answer: number }[];
      const ans = JSON.parse(attempt.answers) as number[];
      const weak = qs.filter((q, i) => Number(ans[i]) !== Number(q.answer)).map((q) => q.prompt);
      quizNote = ` · quiz ${attempt.score}%${weak.length ? ` — reinforce: ${weak.slice(0, 2).join("; ")}` : ""}`;
    } catch {
      /* ignore */
    }
  }

  const mgr = app.role.manager;
  await sendOpsAlert(
    `🧰 ${app.candidate.fullName} (${app.role.displayName}) → ${mgr?.name ?? "manager"}` +
      `${mgr?.telegramHandle ? ` (${mgr.telegramHandle})` : ""}: ${hasAccount ? "HAS an account — assess & start posting" : "needs an account set up + warmed"}${quizNote}`
  );
  await prisma.notification.create({
    data: {
      type: "manager_handoff",
      channel: "ops",
      payload: JSON.stringify({ applicationId, hasAccount, candidate: app.candidate.fullName, manager: mgr?.name }),
    },
  });
  await auditLog("routed_to_manager", "Application", applicationId, { hasAccount, manager: mgr?.name });
}

// ── Trial submission ─────────────────────────────────────────────────────────

/**
 * Auto-hand a free pool account to a fresh hire and DM them the login. Claims
 * the oldest un-claimed account matching their platform + assigned model, which
 * drops it from the pool so it's never handed twice. Notifies ops on every claim
 * (→ @swiftofmm) and alerts loudly when the pool is empty. Non-fatal by design —
 * a hire never fails because the pool is dry.
 */
async function handOutAccount(
  app: {
    id: string;
    candidateId: string;
    candidate: { fullName: string; telegramChatId: string | null };
    role: { key: string; manager: { name: string; telegramHandle: string | null } | null };
  },
  creatorId: string
) {
  const platform = ROLE_PLATFORM[app.role.key];
  if (!platform) return;
  const user = await prisma.user.findFirst({ where: { candidateId: app.candidateId } });
  if (!user) return;

  const acct = await claimNextAccount({ platform, creatorId, userId: user.id });
  if (!acct) {
    await sendOpsAlert(
      `⚠ ${app.candidate.fullName} was onboarded for ${platform} but the ACCOUNT POOL IS EMPTY — hand one over manually and top up the pool.`
    );
    return;
  }

  const platformLabel = platform === "x" ? "X (Twitter)" : platform === "reddit" ? "Reddit" : platform;
  const safety =
    app.role.key === "reddit_va"
      ? "Warm it a couple of days (join subs, upvote, a few comments) before posting NSFW"
      : "Mark the account 'sensitive' in settings, then warm it a day or two before hard posting";
  const mgr = app.role.manager;
  const mgrRef = mgr ? `${mgr.name}${mgr.telegramHandle ? ` (${mgr.telegramHandle})` : ""}` : "Your manager";
  // Only the VA-facing fields (username + password). Email/tokens/2FA-secret stay
  // with the operator for recovery — the VA gets 2FA codes by messaging "code".
  const [uname, pass] = (acct.login ?? "").split(":");
  const body =
    `🔑 Your ${platformLabel} account is ready — log in from your OWN phone/computer:\n\n` +
    `Username: ${uname}\n` +
    `Password: ${pass ?? ""}\n\n` +
    `Do this first:\n` +
    `1. Log in with the above and CHANGE the password\n` +
    `2. If it asks for a 2-factor code, just message me "code" and I'll send it 🔐\n` +
    `3. ${safety}\n\n` +
    `This account is yours alone — never share the login. ${mgrRef} will coach you 💪`;
  const r = await sendTelegramMessage(app.candidate.telegramChatId, body);
  await prisma.message.create({
    data: {
      candidateId: app.candidateId,
      applicationId: app.id,
      direction: "outbound",
      channel: "telegram",
      templateKey: "account_handout",
      body,
      status: r.status,
    },
  });
  const left = await prisma.account.count({
    where: { platform, login: { not: null }, status: { in: ["warming", "active"] }, grants: { none: { status: "active" } } },
  });
  await sendOpsAlert(`🔑 ${app.candidate.fullName} was auto-handed ${platform}/${acct.handle} — ${left} left in the pool.`);
  // Tell them to actually TURN the account into the model — pool accounts are
  // dead/random-username profiles, and VAs won't do this without being told.
  await sendProfileSetup(app.candidateId).catch(() => {});
}

/**
 * The "make this account look like the model" step. Pool accounts arrive as
 * random-username dead profiles, so — every time an account is handed over — spell
 * out the profile setup (name → model, profile pic + banner from the content
 * folder, promo link in the bio). Common sense to us, not to every VA; sending it
 * automatically means you never have to say it again.
 */
async function sendProfileSetup(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate?.telegramChatId) return;
  const user = await prisma.user.findFirst({ where: { candidateId } });
  if (!user) return;
  const asg = await prisma.assignment.findFirst({
    where: { userId: user.id, status: { in: ["probation", "active"] } },
    orderBy: { createdAt: "desc" },
    include: { creator: true, role: true },
  });
  if (!asg) return;
  const model = asg.creator?.name ?? "your model";
  let folder = asg.creator?.contentDriveUrl ?? "";
  try {
    const drives = asg.creator?.contentDrives ? JSON.parse(asg.creator.contentDrives) : {};
    folder = drives[asg.role.key] ?? asg.creator?.contentDriveUrl ?? "";
  } catch {
    /* keep the general drive */
  }
  const link = asg.trialLinkUrl || asg.creator?.ofTrialUrl || "";
  const follow = followExamplesBlock();
  const body =
    `✨ IMPORTANT — set the account up as ${model} BEFORE you post. A random-looking profile won't get subs, so do ALL of this first:\n\n` +
    `• NAME → change the display name to "${model}"\n` +
    `• PROFILE PICTURE → use a photo of ${model} from the content folder\n` +
    `• BANNER / HEADER → set one from the folder too\n` +
    `• BIO → write a short bio and put your promo link in it:\n${link || `(message me "link" and I'll send it)`}\n\n` +
    `📁 Content folder: ${folder || `(message your manager for it)`}\n\n` +
    (follow ? `${follow}\n\n` : "") +
    `This is what turns a dead account into ${model} — do it before your first post 🔥`;
  const r = await sendTelegramMessage(candidate.telegramChatId, body);
  await prisma.message.create({
    data: { candidateId, direction: "outbound", channel: "telegram", templateKey: "profile_setup", body, status: r.status },
  });
}

/** Slug-safe first name for the promo link (e.g. "Ryan" → "ryan"). */
function promoSlugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "va";
}

/**
 * Give this assignment a personal promo link (/go/<slug>) exactly once, so it can
 * be DM'd to the VA and every click is tracked to them. Idempotent — an existing
 * slug is kept. The slug ends in the assignment id suffix so it's always unique.
 */
export async function ensurePromoLink(assignmentId: string, firstName: string) {
  const asg = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!asg) return;
  // Already fully set up — slug AND a real (non-empty) link. Nothing to do.
  if (asg.trackSlug && asg.promoLink) return;
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  // Without a base URL we can't build a real link — bail rather than storing an
  // empty one. A later run (once NEXT_PUBLIC_BASE_URL is set) will fill it in.
  // This is the bug that left VAs stuck on "no link yet": previously we minted a
  // slug with an empty promoLink and then never revisited it.
  if (!base) return;
  // Reuse any existing slug so the link stays stable; only mint one if missing.
  const slug = asg.trackSlug || `${promoSlugify(firstName)}${asg.id.slice(-6)}`;
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { trackSlug: slug, promoLink: `${base}/go/${slug}` },
  });
}

/**
 * Rebuild a VA's promo link around a NEW name they've asked for (e.g. a persona
 * name — "put Shan in my link instead"). Regenerates the /go slug + link so the
 * name they post reads how they want, keeping the unique assignment suffix so it
 * never collides. The old slug stops resolving, so the caller tells them to
 * re-post the new one. Handles the class of request the bot used to escalate to
 * a human. Returns the new link (null if no base URL / assignment) + clean name.
 */
export async function renamePromoLink(
  assignmentId: string,
  newName: string
): Promise<{ link: string | null; displayName: string }> {
  const displayName = newName.trim().replace(/\s+/g, " ").slice(0, 24);
  const asg = await prisma.assignment.findUnique({ where: { id: assignmentId }, include: { user: true } });
  if (!asg) return { link: null, displayName };
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const slug = `${promoSlugify(newName)}${asg.id.slice(-6)}`;
  const link = base ? `${base}/go/${slug}` : "";
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { trackSlug: slug, promoLink: link },
  });
  await auditLog("promo_link_renamed", "Assignment", assignmentId, { newName: displayName, slug });
  // FYI to ops so you know this VA now goes by this name on their link — no action needed.
  await sendOpsAlert(
    `🔤 ${asg.user?.name ?? "A VA"} set their promo-link name to "${displayName}" (self-serve). New link: ${link || "(no base URL set)"}`
  ).catch(() => {});
  return { link: link || null, displayName };
}

/**
 * Stamp each model's OF free-trial link from config into the DB. The deploy's
 * `start` script runs migrations but NOT the seed, so a stored ofTrialUrl that
 * got mis-set to the paid profile URL would otherwise never be repaired on
 * deploy — leaving /go's fallback pointing at the paywall. Runs on every boot
 * (idempotent): only touches models whose config gives a non-empty link and
 * whose stored value differs. This is what makes the free-trial fix self-heal.
 */
export async function repairModelTrialLinks(): Promise<{ repaired: number }> {
  let repaired = 0;
  for (const c of CREATORS) {
    if (!c.ofTrialUrl) continue; // blank config = leave the DB value alone
    const creator = await prisma.creator.findFirst({ where: { name: c.name } });
    if (!creator || creator.ofTrialUrl === c.ofTrialUrl) continue;
    await prisma.creator.update({ where: { id: creator.id }, data: { ofTrialUrl: c.ofTrialUrl } });
    repaired++;
  }
  if (repaired > 0) {
    await sendOpsAlert(`🔗 Repaired ${repaired} model free-trial link(s) from config on boot.`).catch(() => {});
  }
  return { repaired };
}

/**
 * Generate a personal promo link for every current VA that's missing one — so
 * VAs hired before this feature (or before their model's OF link was set) get
 * theirs in one click. Idempotent: VAs who already have a slug are skipped.
 */
export async function backfillPromoLinks(): Promise<{ generated: number; total: number; trialLinksAssigned: number }> {
  // 1) Give a /go promo link to anyone missing one — including VAs who got a
  //    slug earlier but an EMPTY promoLink (base URL wasn't set at the time).
  const missingSlug = await prisma.assignment.findMany({
    where: {
      status: { in: ["probation", "active"] },
      OR: [{ trackSlug: null }, { promoLink: null }, { promoLink: "" }],
    },
    include: { user: true },
  });
  let generated = 0;
  for (const a of missingSlug) {
    await ensurePromoLink(a.id, firstNameOf(a.user.name || "VA")).catch(() => {});
    generated++;
  }
  // 2) Claim an Infloww trial link from the pool for anyone missing one (covers
  //    VAs hired before the pool was stocked). Matches their model + platform.
  const missingTrialLink = await prisma.assignment.findMany({
    where: { status: { in: ["probation", "active"] }, trialLinkUrl: null },
    select: { id: true },
  });
  let trialLinksAssigned = 0;
  for (const a of missingTrialLink) {
    const r = await claimTrialLink(a.id).catch(() => ({ claimed: false }));
    if (r.claimed) trialLinksAssigned++;
  }
  return { generated, total: missingSlug.length, trialLinksAssigned };
}

/**
 * DM every active VA their personal promo link with placement instructions —
 * so VAs hired before the link system existed (or whose link was blank) actually
 * RECEIVE it, not just have it sitting on the dashboard. Runs the backfill first
 * so everyone has a link + pool trial link, then sends. Skips VAs with no link
 * yet or no bound chat, and reports the counts.
 */
export async function sendPersonalLinks(opts?: { onlyUnsent?: boolean }): Promise<{
  sent: number;
  noLink: number;
  noChat: number;
  skipped: number;
  total: number;
}> {
  await backfillPromoLinks().catch(() => {});
  const assignments = await prisma.assignment.findMany({
    where: { status: { in: ["probation", "active"] } },
    include: { user: { include: { fromCandidate: true } }, role: true, creator: true },
  });
  // When only sending to VAs who've never received their link (the automatic
  // daily job), look up who already got a personal_link message so we don't
  // re-spam anyone. The manual "Send links" button omits opts → sends to all.
  let alreadySent = new Set<string>();
  if (opts?.onlyUnsent) {
    const prior = await prisma.message.findMany({
      where: { templateKey: "personal_link" },
      select: { candidateId: true },
    });
    alreadySent = new Set(prior.map((m) => m.candidateId).filter(Boolean) as string[]);
  }
  let sent = 0;
  let noLink = 0;
  let noChat = 0;
  let skipped = 0;
  for (const a of assignments) {
    const cand = a.user?.fromCandidate;
    // The VA posts their RAW OnlyFans free-trial link (their own Infloww link,
    // else the model's shared trial link) — never the /go wrapper. Subs are
    // attributed to them in Infloww by their link.
    const link = a.trialLinkUrl || a.creator?.ofTrialUrl || "";
    if (!link) {
      noLink++;
      continue;
    }
    if (!cand?.telegramChatId) {
      noChat++;
      continue;
    }
    if (opts?.onlyUnsent && cand.id && alreadySent.has(cand.id)) {
      skipped++;
      continue;
    }
    const platform = ROLE_PLATFORM[a.role.key];
    const placement =
      platform === "x"
        ? "Put it in your X bio AND drop it in the comments of EVERY post — that's how fans find it."
        : platform === "reddit"
          ? "Put it in your Reddit bio so it sits on every post you make."
          : "Keep it in your bio so fans can always find it.";
    const body =
      `🔗 ${firstNameOf(cand.fullName)} — this is your NEW link. Use ONLY this one from now on:\n\n` +
      `${link}\n\n` +
      `✅ It's a clean OnlyFans link — looks legit, loads instantly and converts better, so you'll pull more subs from the same traffic. It's also how we track your results now, so every sub you bring is credited to you.\n\n` +
      `📍 Add this to your bio right now. ${placement} If you've got any old link anywhere, delete it and use only this one.`;
    const r = await sendTelegramMessage(cand.telegramChatId, body);
    await prisma.message.create({
      data: { candidateId: cand.id, direction: "outbound", channel: "telegram", templateKey: "personal_link", body, status: r.status },
    });
    sent++;
  }
  return { sent, noLink, noChat, skipped, total: assignments.length };
}

/**
 * Onboard a candidate all the way to ACTIVE and auto-hand them a pool account —
 * fully hands-off so VAs get started without the operator present. Shared by the
 * X path (after they SUBMIT their trial) and the Reddit path (straight after the
 * quiz — no trial). Creates the User + model assignment, sends the offer + full
 * welcome, then claims + DMs an account. Parks + alerts if no model is available.
 */
export async function onboardAndActivate(applicationId: string, actorUserId?: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { candidate: true, role: { include: { manager: true } } },
  });
  if (!app) throw new Error("application not found");
  try {
    await moveStage(applicationId, "ONBOARDING", actorUserId); // creates User + auto-assigns a model
    // Never complete to ACTIVE with no model FOR THIS ROLE — that's a hired-but-
    // orphaned VA. Park at ONBOARDING + hard-alert so a model is assigned by hand.
    const assigned = await prisma.assignment.findFirst({
      where: { user: { candidateId: app.candidateId }, roleId: app.roleId, status: { in: ["probation", "active"] } },
    });
    if (!assigned) {
      const hold = `Great news — you're through ✅ We're finalising your setup and your manager will confirm your model + details shortly. Hang tight! 🙌`;
      const hr = await sendTelegramMessage(app.candidate.telegramChatId, hold);
      await prisma.message.create({
        data: { candidateId: app.candidateId, applicationId, direction: "outbound", channel: "telegram", templateKey: "hire_holding", body: hold, status: hr.status },
      });
      await sendOpsAlert(
        `⚠ ${app.candidate.fullName} onboarded but NO model was assigned for ${app.roleId} (no active model?). Parked — assign a model to finish.`
      );
      await auditLog("hire_needs_model", "Application", applicationId, {}, actorUserId);
      return;
    }
    // Generate their personal, tracked promo link BEFORE the welcome so it renders.
    await ensurePromoLink(assigned.id, firstNameOf(app.candidate.fullName)).catch(() => {});
    // Claim their own Infloww trial link from the pool (per-VA sub attribution).
    // Their /go link then redirects here; falls back to the model's shared link.
    await claimTrialLink(assigned.id).catch(() => {});
    await sendTemplatedMessage(applicationId, "offer");
    await moveStage(applicationId, "ACTIVE", actorUserId);
    // Full setup message — model, drive, target, pay, group, manager. Sent after
    // ONBOARDING so the merge context sees the real assignment.
    await sendTemplatedMessage(applicationId, "onboarding");
    // Auto-hand them a pool account + DM the login (the "given an account" step).
    await handOutAccount(app, assigned.creatorId).catch(() => {});
    await auditLog("auto_hired", "Application", applicationId, {}, actorUserId);
    const mgr = app.role.manager;
    // Manager handoff packet — the model + content folder + promo link nailed
    // down BEFORE the VA is left to their manager (Reddit → Haria), so nobody
    // picks up a VA who doesn't know their model or has nothing to post.
    const ctx = await buildMergeContext(applicationId);
    if (!ctx.content_drive_url) {
      await sendOpsAlert(
        `⚠ ${app.candidate.fullName} was onboarded for ${app.role.displayName} on ${ctx.model_name}, but that model has NO ${app.role.displayName} content folder set. Add it on /vas so they know what to post before ${mgr?.name ?? "their manager"} takes over.`
      );
    }
    const mgrRef = mgr ? `${mgr.name}${mgr.telegramHandle ? ` (${mgr.telegramHandle})` : ""}` : "their manager";
    await sendOpsAlert(
      `✅ New ${app.role.displayName} — hand off to ${mgrRef}\n` +
        `• VA: ${app.candidate.fullName}\n` +
        `• Model: ${ctx.model_name}\n` +
        `• Content folder: ${ctx.content_drive_url || "⚠ NOT SET"}\n` +
        `• Their promo link: ${ctx.promo_link || "—"}`
    );
  } catch (e: any) {
    await sendOpsAlert(
      `⚠ Onboarding hit a snag for application ${applicationId} (${e?.message ?? "unknown"}). Finish onboarding manually.`
    );
  }
}

/**
 * DM a VA the login for an account they hold — used when an account is granted
 * MANUALLY on the Accounts page. (The auto-handout DMs it on hire; a manual grant
 * previously didn't, leaving the VA with an account they couldn't open.) Returns
 * why it couldn't send so the grant response can surface it.
 */
export async function deliverAccountLogin(
  accountId: string,
  userId: string
): Promise<{ sent: boolean; reason?: string }> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account?.login) return { sent: false, reason: "no login is stored on this account" };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.candidateId) return { sent: false, reason: "this VA has no linked candidate/chat" };
  const candidate = await prisma.candidate.findUnique({ where: { id: user.candidateId } });
  if (!candidate?.telegramChatId)
    return { sent: false, reason: "this VA never messaged the bot, so there's no chat to DM" };

  const asg = await prisma.assignment.findFirst({
    where: { userId, status: { in: ["probation", "active"] } },
    orderBy: { createdAt: "desc" },
    include: { role: { include: { manager: true } } },
  });
  const platform = account.platform;
  const platformLabel = platform === "x" ? "X (Twitter)" : platform === "reddit" ? "Reddit" : platform;
  const isReddit = platform === "reddit" || asg?.role.key === "reddit_va";
  const safety = isReddit
    ? "Warm it a couple of days (join subs, upvote, a few comments) before posting NSFW"
    : "Mark the account 'sensitive' in settings, then warm it a day or two before hard posting";
  const mgr = asg?.role.manager;
  const mgrRef = mgr ? `${mgr.name}${mgr.telegramHandle ? ` (${mgr.telegramHandle})` : ""}` : "Your manager";
  // Only the VA-facing fields (username + password). Email/tokens/2FA-secret stay
  // with the operator for recovery — the VA gets 2FA codes by messaging "code".
  const [uname, pass] = (account.login ?? "").split(":");
  const body =
    `🔑 Your ${platformLabel} account is ready — log in from your OWN phone/computer:\n\n` +
    `Username: ${uname}\n` +
    `Password: ${pass ?? ""}\n\n` +
    `Do this first:\n` +
    `1. Log in with the above and CHANGE the password\n` +
    `2. If it asks for a 2-factor code, just message me "code" and I'll send it 🔐\n` +
    `3. ${safety}\n\n` +
    `This account is yours alone — never share the login. ${mgrRef} will coach you 💪`;
  const r = await sendTelegramMessage(candidate.telegramChatId, body);
  await prisma.message.create({
    data: { candidateId: candidate.id, direction: "outbound", channel: "telegram", templateKey: "account_handout", body, status: r.status },
  });
  // Always follow the login with the "turn it into the model" profile step.
  await sendProfileSetup(candidate.id).catch(() => {});
  return { sent: true };
}

/**
 * A VA's account is down (banned/shadowbanned). Auto-recover from the pool: hand
 * them a fresh account and DM the login right away so they're never left idle on
 * a manual swap. Deliberately ADDITIVE — we never auto-revoke or mark the old
 * account banned, because the trigger (VA saying "locked out"/"banned") can be a
 * transient lockout, and destroying a good account is worse than the idle it
 * fixes. The human retires the genuinely-dead account from /accounts. Returns
 * whether a fresh account was handed, its handle, whether they already held one,
 * and whether the pool was empty.
 */
export async function autoReplaceAccount(
  candidateId: string
): Promise<{ replaced: boolean; handle?: string; hadOne?: boolean; poolEmpty?: boolean }> {
  const user = await prisma.user.findFirst({ where: { candidateId } });
  if (!user) return { replaced: false };
  const asg = await prisma.assignment.findFirst({
    where: { userId: user.id, status: { in: ["probation", "active"] } },
    orderBy: { createdAt: "desc" },
    include: { role: true },
  });
  const platform = asg ? ROLE_PLATFORM[asg.role.key] : undefined;
  if (!platform) return { replaced: false };

  const hadOne =
    (await prisma.accessGrant.count({
      where: { userId: user.id, status: "active", account: { platform } },
    })) > 0;

  const fresh = await claimNextAccount({ platform, creatorId: asg?.creatorId ?? null, userId: user.id });
  if (!fresh) return { replaced: false, hadOne, poolEmpty: true };

  await deliverAccountLogin(fresh.id, user.id).catch(() => {});
  return { replaced: true, handle: fresh.handle, hadOne };
}

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

  // Mass-hire: submitting the trial IS the hire. Onboard → ACTIVE → auto-hand a
  // pool account, regardless of score (scoring still records for training
  // triage, but never gates). Fully hands-off via the shared onboard path.
  if (AUTO_HIRE) await onboardAndActivate(applicationId, actorUserId);

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
