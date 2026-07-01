// Trial deadline automation: T-12h and T-2h reminders, and auto-expire when the
// 24h window passes with no submission. Driven by the in-process scheduler.

import { prisma } from "./db";
import { sendTelegramMessage, sendOpsAlert } from "./telegram";
import { firstNameOf } from "./templates";

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
  for (const t of trials) {
    const dl = t.deadlineAt!.getTime();
    const cand = t.application.candidate;

    if (now >= dl) {
      await prisma.trial.update({ where: { id: t.id }, data: { status: "expired" } });
      await prisma.notification.create({
        data: { type: "trial_expired", channel: "ops", payload: JSON.stringify({ trialId: t.id }) },
      });
      await sendOpsAlert(`⌛ Trial EXPIRED (no submission): ${cand.fullName} (${t.application.role.displayName}).`);
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
  return { reminded, expired };
}
