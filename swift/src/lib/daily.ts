// Daily VA reporting: an operator digest ("what each VA did, who's offline") and
// per-VA morning messages ("here's where to tighten up today"). Both run from
// cron routes. "Online" is approximated by whether the VA messaged today (Bot
// API can't read true presence — that needs a userbot).

import { prisma } from "./db";
import { sendOpsAlert, sendTelegramMessage } from "./telegram";
import { firstNameOf } from "./templates";
import { ROLE_TARGETS } from "./roles-config";
import { deadlineLabel } from "./ui";

const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

async function messagedSince(candidateId: string, since: Date) {
  return prisma.message.count({
    where: { candidateId, direction: "inbound", createdAt: { gte: since } },
  });
}

async function postsObservedSince(trialId: string, since: Date) {
  const events = await prisma.activityEvent.findMany({
    where: { trialId, type: "post_observed", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  if (events[0]) {
    try {
      return JSON.parse(events[0].payload ?? "{}").posts ?? 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

// Max VAs/trials to enumerate line-by-line before we switch to a count. Keeps
// the digest well under Telegram's 4096-char message limit at mass-hire scale.
const DIGEST_MAX_DETAIL = 25;
const DIGEST_MAX_CHARS = 3800;

/** Build the operator's daily rundown across active trials + hired VAs. */
export async function buildDailyDigest(): Promise<string> {
  const today = startOfDay();
  const lines: string[] = [`📊 Daily VA digest — ${today.toDateString()}`, ""];

  // Trials GENUINELY in progress = the application is still at TRIAL_READY /
  // TRIAL_ACTIVE. (Auto-hired trials keep status 'submitted' forever but their
  // application is ACTIVE — counting those would list every hire as "in
  // progress" and balloon the message past Telegram's limit.)
  const inProgressWhere = {
    status: { in: ["active", "submitted"] },
    application: { stage: { in: ["TRIAL_READY", "TRIAL_ACTIVE"] } },
  };
  const trialCount = await prisma.trial.count({ where: inProgressWhere });
  const trials = await prisma.trial.findMany({
    where: inProgressWhere,
    include: { application: { include: { candidate: true, role: true } }, scoreCard: true },
    orderBy: { deadlineAt: "asc" },
    take: DIGEST_MAX_DETAIL,
  });
  lines.push(`Trials in progress (${trialCount})`);
  if (trialCount === 0) lines.push("• none");
  for (const t of trials) {
    const c = t.application.candidate;
    const online = (await messagedSince(c.id, today)) > 0;
    const posts = await postsObservedSince(t.id, today);
    const rating = t.scoreCard?.autoRating;
    const dl = deadlineLabel(t.deadlineAt);
    lines.push(
      `• ${c.fullName} — ${t.application.role.displayName}: ${posts} posts, ` +
        `${rating != null ? `auto ${rating}/10, ` : ""}${dl.text}, ${online ? "🟢" : "🔴"}`
    );
  }
  if (trialCount > DIGEST_MAX_DETAIL) lines.push(`• …and ${trialCount - DIGEST_MAX_DETAIL} more`);

  // Hired / active VAs — SUMMARISED (per model + per role). Listing every VA at
  // ~200 hires blows past 4096 chars and the whole digest silently never sends.
  const assignments = await prisma.assignment.findMany({
    where: { status: { in: ["probation", "active"] } },
    include: { creator: true, role: true },
  });
  const byModel = new Map<string, number>();
  const byRole = new Map<string, number>();
  for (const a of assignments) {
    byModel.set(a.creator.name, (byModel.get(a.creator.name) ?? 0) + 1);
    byRole.set(a.role.displayName, (byRole.get(a.role.displayName) ?? 0) + 1);
  }
  lines.push("", `Active VAs (${assignments.length})`);
  if (assignments.length === 0) lines.push("• none");
  else {
    lines.push("• by model: " + [...byModel.entries()].map(([n, c]) => `${n} ${c}`).join(" · "));
    lines.push("• by role: " + [...byRole.entries()].map(([n, c]) => `${n} ${c}`).join(" · "));
  }

  // Delivery health: outbound messages that actually FAILED today (not the
  // expected "simulated" when no token is set).
  const failed = await prisma.message.count({
    where: { direction: "outbound", status: "failed", createdAt: { gte: today } },
  });
  if (failed > 0) lines.push("", `⚠ ${failed} message(s) failed to send today — check the bot token/webhook.`);

  // Hard cap so a surprise still can't exceed Telegram's limit.
  let out = lines.join("\n");
  if (out.length > DIGEST_MAX_CHARS) out = out.slice(0, DIGEST_MAX_CHARS) + "\n… (truncated)";
  return out;
}

/** Send the digest to the ops channel and record it. */
export async function sendDailyDigest() {
  const text = await buildDailyDigest();
  await sendOpsAlert(text);
  await prisma.activityEvent.create({ data: { type: "digest_sent", payload: JSON.stringify({ at: Date.now() }) } });
  return text;
}

/** Per-VA morning message: yesterday's count + today's focus. */
export function buildMorningMessage(opts: {
  fullName: string;
  roleKey: string;
  roleName: string;
  postsYesterday: number;
  focusHint?: string;
}): string {
  const target = ROLE_TARGETS[opts.roleKey];
  const focus = opts.focusHint ?? (target ? target.label : "hit your daily output and keep it well spaced");
  return [
    `Good morning ${firstNameOf(opts.fullName)} ☀️`,
    "",
    `Yesterday: ${opts.postsYesterday} post${opts.postsYesterday === 1 ? "" : "s"} logged.`,
    `Today's focus (${opts.roleName}): ${focus}.`,
    "Spread your posts across the day — keep it natural. Let me know when your first one's up 🙂",
  ].join("\n");
}

/** Send morning messages to everyone currently on a trial. */
export async function sendMorningMessages() {
  const yesterday = startOfDay(new Date(Date.now() - 86_400_000));
  const today = startOfDay();
  const trials = await prisma.trial.findMany({
    where: { status: { in: ["active"] } },
    include: { application: { include: { candidate: true, role: true } } },
  });
  let sent = 0;
  let failed = 0;
  for (const t of trials) {
    const c = t.application.candidate;
    const events = await prisma.activityEvent.findMany({
      where: { trialId: t.id, type: "post_observed", createdAt: { gte: yesterday, lt: today } },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    let postsYesterday = 0;
    if (events[0]) {
      try {
        postsYesterday = JSON.parse(events[0].payload ?? "{}").posts ?? 0;
      } catch {}
    }
    const body = buildMorningMessage({
      fullName: c.fullName,
      roleKey: t.application.role.key,
      roleName: t.application.role.displayName,
      postsYesterday,
    });
    const r = await sendTelegramMessage(c.telegramChatId, body);
    await prisma.message.create({
      data: { candidateId: c.id, direction: "outbound", channel: "telegram", templateKey: "morning", body, status: r.status },
    });
    await prisma.activityEvent.create({
      data: { candidateId: c.id, trialId: t.id, type: "morning_sent", payload: JSON.stringify({ postsYesterday }) },
    });
    if (r.status === "failed") failed++;
    else sent++;
  }
  return { sent, failed };
}
