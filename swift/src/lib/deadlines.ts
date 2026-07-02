// Trial deadline automation: T-12h and T-2h reminders, auto-expire when the
// window passes, a re-engagement DM on expiry, and a one-time nudge for managed
// (Reddit) candidates who stall at the account step. Driven by the scheduler.

import { prisma } from "./db";
import { sendTelegramMessage, sendOpsAlert } from "./telegram";
import { firstNameOf } from "./templates";
import { sendTemplatedMessage } from "./services";

// Hours a managed (Reddit) candidate may sit at the account step before we nudge.
// Parse defensively: a bad/empty/negative env value must NOT collapse to 0/NaN
// (which would make every managed candidate get nudged instantly) — fall back to 12.
const STALL_HOURS = (() => {
  const h = Number(process.env.ACCOUNT_STALL_HOURS);
  return Number.isFinite(h) && h > 0 ? h : 12;
})();
const STALL_MS = STALL_HOURS * 3600_000;

async function nudge(candidateId: string, chatId: string | null, fullName: string, tag: string, hoursLeft: number) {
  const body =
    `Hey ${firstNameOf(fullName)} — about ${hoursLeft}h left on your trial 🙂 ` +
    `Make sure your posts are up and send me the links before the deadline.`;
  const r = await sendTelegramMessage(chatId, body);
  await prisma.message.create({
    data: { candidateId, direction: "outbound", channel: "telegram", templateKey: `reminder_${tag}`, body, status: r.status },
  });
}

export async function runDeadlineChecks() {
  const now = Date.now();
  const trials = await prisma.trial.findMany({
    where: { status: "active", deadlineAt: { not: null } },
    include: { application: { include: { candidate: true, role: true } } },
  });

  let reminded = 0;
  let expired = 0;
  let nudged = 0;
  for (const t of trials) {
    const dl = t.deadlineAt!.getTime();
    const cand = t.application.candidate;

    if (now >= dl) {
      await prisma.trial.update({ where: { id: t.id }, data: { status: "expired" } });
      await prisma.notification.create({
        data: { type: "trial_expired", channel: "ops", payload: JSON.stringify({ trialId: t.id }) },
      });
      // Re-engage the candidate instead of leaving them in silence — a late
      // submission is still welcome under mass-hire.
      const body =
        `Hey ${firstNameOf(cand.fullName)} — your trial window just passed ⏰ but I don't want you to miss out. ` +
        `If you're close, send your post link here with the word SUBMIT and I'll still take it 🙌`;
      const rr = await sendTelegramMessage(cand.telegramChatId, body);
      await prisma.message.create({
        data: {
          candidateId: cand.id,
          applicationId: t.applicationId,
          direction: "outbound",
          channel: "telegram",
          templateKey: "trial_expired_reengage",
          body,
          status: rr.status,
        },
      });
      await sendOpsAlert(
        `⌛ Trial EXPIRED: ${cand.fullName} (${t.application.role.displayName}) — nudged them for a late submission.`
      );
      expired++;
      continue;
    }

    const hoursLeft = Math.max(1, Math.round((dl - now) / 3600_000));
    if (now >= dl - 12 * 3600_000 && !t.remind12hSent) {
      await nudge(cand.id, cand.telegramChatId, cand.fullName, "t12h", hoursLeft);
      await prisma.trial.update({ where: { id: t.id }, data: { remind12hSent: true } });
      reminded++;
    }
    if (now >= dl - 2 * 3600_000 && !t.remind2hSent) {
      await nudge(cand.id, cand.telegramChatId, cand.fullName, "t2h", hoursLeft);
      await prisma.trial.update({ where: { id: t.id }, data: { remind2hSent: true } });
      reminded++;
    }
  }

  // ── Managed (Reddit) account step: nudge candidates who've stalled ──────────
  // This step has no hard clock, so without this a Reddit candidate who never
  // answers YES/NO, or who never messages the manager, sits in total silence.
  // Fire exactly once (managerNudgeSent), then the stale sweep surfaces it to ops.
  const stalled = await prisma.trial.findMany({
    where: {
      status: { in: ["account_check", "with_manager"] },
      managerNudgeSent: false,
      application: { role: { managerUserId: { not: null } } },
    },
    include: { application: { include: { candidate: true, role: { include: { manager: true } } } } },
  });
  for (const t of stalled) {
    if (now - t.updatedAt.getTime() < STALL_MS) continue;
    const cand = t.application.candidate;
    if (t.status === "account_check") {
      // Never answered the account question — re-ask it.
      await sendTemplatedMessage(t.applicationId, "account_check");
    } else {
      // Answered, but hasn't got moving with the manager — point them there.
      const mgr = t.application.role.manager;
      const link = mgr?.telegramHandle
        ? `https://t.me/${mgr.telegramHandle.replace(/^@/, "")}`
        : mgr?.telegramHandle ?? "your manager";
      const body =
        `Hey ${firstNameOf(cand.fullName)} — quick check-in 🙂 To keep your ${t.application.role.displayName} spot moving, ` +
        `message your manager here: ${link}. Once you're posting, drop your link here with the word SUBMIT 🚀`;
      const r = await sendTelegramMessage(cand.telegramChatId, body);
      await prisma.message.create({
        data: {
          candidateId: cand.id,
          applicationId: t.applicationId,
          direction: "outbound",
          channel: "telegram",
          templateKey: "manager_nudge",
          body,
          status: r.status,
        },
      });
    }
    await prisma.trial.update({ where: { id: t.id }, data: { managerNudgeSent: true } });
    await sendOpsAlert(
      `⏰ ${cand.fullName} (${t.application.role.displayName}) stalled at "${t.status}" — nudged them. Manager may need to follow up.`
    );
    nudged++;
  }

  return { reminded, expired, nudged };
}
