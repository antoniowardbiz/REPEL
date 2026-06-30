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

/** Build the operator's daily rundown across active trials + hired VAs. */
export async function buildDailyDigest(): Promise<string> {
  const today = startOfDay();
  const lines: string[] = [`📊 *Daily VA digest* — ${today.toDateString()}`, ""];

  // Active trials
  const trials = await prisma.trial.findMany({
    where: { status: { in: ["active", "submitted"] } },
    include: {
      application: { include: { candidate: true, role: true } },
      scoreCard: true,
      watch: true,
    },
    orderBy: { deadlineAt: "asc" },
  });
  lines.push(`*Trials in progress (${trials.length})*`);
  if (trials.length === 0) lines.push("• none");
  for (const t of trials) {
    const c = t.application.candidate;
    const online = (await messagedSince(c.id, today)) > 0;
    const posts = await postsObservedSince(t.id, today);
    const rating = t.scoreCard?.autoRating;
    const dl = deadlineLabel(t.deadlineAt);
    lines.push(
      `• ${c.fullName} — ${t.application.role.displayName}: ${posts} posts today, ` +
        `${rating != null ? `auto ${rating}/10, ` : ""}${dl.text}, ${online ? "🟢 online today" : "🔴 not seen today"}`
    );
  }

  // Hired / active VAs
  const assignments = await prisma.assignment.findMany({
    where: { status: { in: ["probation", "active"] } },
    include: { user: { include: { fromCandidate: true } }, creator: true, role: true },
  });
  lines.push("", `*Active VAs (${assignments.length})*`);
  if (assignments.length === 0) lines.push("• none");
  for (const a of assignments) {
    const candId = a.user.candidateId;
    const online = candId ? (await messagedSince(candId, today)) > 0 : false;
    lines.push(
      `• ${a.user.name} — ${a.role.displayName} @ ${a.creator.name} (${a.status})` +
        `${candId ? `, ${online ? "🟢 online today" : "🔴 not seen today"}` : ""}`
    );
  }

  // Delivery health: outbound messages that actually FAILED today (not the
  // expected "simulated" when no token is set).
  const failed = await prisma.message.count({
    where: { direction: "outbound", status: "failed", createdAt: { gte: today } },
  });
  if (failed > 0) lines.push("", `⚠ Delivery issues today: ${failed} message(s) failed to send — check the bot token/webhook.`);

  return lines.join("\n");
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
