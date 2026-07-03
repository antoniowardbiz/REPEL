// Proactive pod coaching. Once a day the bot looks at every hired VA's activity
// signal (promo-link clicks + messages to the bot — the only things we can
// actually see, since there's no Reddit/X API), then:
//   • praises the strong (with their standing in their small model+platform pod),
//   • nudges the quiet with a curious, supportive tone,
//   • escalates the genuinely stuck to their manager,
//   • tracks activity streaks with recovery-first framing (a miss is a comeback,
//     never a shaming reset).
// It kills the "you don't know how you're doing until you're fired" problem —
// and it never nags: steady-active VAs get left alone, and no one is messaged
// twice in a day. Signal is a proxy for effort, so nudges assume the best.

import { prisma } from "./db";
import { sendTelegramMessage, sendOpsAlert } from "./telegram";
import { firstNameOf } from "./templates";
import { ROLE_PLATFORM } from "./roles-config";

const DAY = 86_400_000;
const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
const platformLabel = (p: string) => (p === "x" ? "X" : p === "reddit" ? "Reddit" : p);

async function logOut(candidateId: string, chatId: string | null, body: string, templateKey: string) {
  const r = await sendTelegramMessage(chatId, body);
  await prisma.message.create({
    data: { candidateId, direction: "outbound", channel: "telegram", templateKey, body, status: r.status },
  });
}

/**
 * Run the daily coaching pass. Idempotent within a day: streaks advance once,
 * and lastCoachedDay stops a VA being messaged twice. Returns a small summary.
 */
export async function runDailyCoaching(): Promise<{ coached: number; escalated: number; praised: number }> {
  const today = startOfDay();
  const yesterday = startOfDay(new Date(Date.now() - DAY));
  const weekAgo = new Date(Date.now() - 7 * DAY);

  const assignments = await prisma.assignment.findMany({
    where: { status: { in: ["probation", "active"] } },
    include: {
      user: { include: { fromCandidate: true } },
      creator: true,
      role: { include: { manager: true } },
    },
  });

  // Activity signals: clicks this week (for pod ranking + baseline), clicks
  // today, and messages-to-the-bot today.
  const [weekClicks, todayClicks, todayMsgs] = await Promise.all([
    prisma.activityEvent.groupBy({
      by: ["userId"],
      where: { type: "promo_click", userId: { not: null }, createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    prisma.activityEvent.groupBy({
      by: ["userId"],
      where: { type: "promo_click", userId: { not: null }, createdAt: { gte: today } },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["candidateId"],
      where: { direction: "inbound", createdAt: { gte: today } },
      _count: { _all: true },
    }),
  ]);
  const weekClickBy = new Map(weekClicks.map((r) => [r.userId as string, r._count._all]));
  const todayClickBy = new Map(todayClicks.map((r) => [r.userId as string, r._count._all]));
  const msgsBy = new Map(todayMsgs.map((r) => [r.candidateId as string, r._count._all]));

  // Pods = model + platform. Rank members by this week's clicks (relative,
  // small-group standing — never a global leaderboard).
  type Row = { a: (typeof assignments)[number]; platform: string; weekC: number };
  const pods = new Map<string, Row[]>();
  const rows: Row[] = [];
  for (const a of assignments) {
    const platform = ROLE_PLATFORM[a.role.key];
    if (!platform) continue;
    const weekC = weekClickBy.get(a.userId) ?? 0;
    const row = { a, platform, weekC };
    rows.push(row);
    const key = `${a.creatorId}/${platform}`;
    (pods.get(key) ?? pods.set(key, []).get(key)!).push(row);
  }
  for (const list of pods.values()) list.sort((x, y) => y.weekC - x.weekC);
  const rankOf = (row: Row) => {
    const list = pods.get(`${row.a.creatorId}/${row.platform}`)!;
    return { rank: list.indexOf(row) + 1, size: list.length };
  };

  let coached = 0,
    escalated = 0,
    praised = 0;

  for (const row of rows) {
    const { a, platform } = row;
    const cand = a.user?.fromCandidate;
    if (!a.user?.candidateId || !cand) continue;
    const chatId = cand.telegramChatId; // may be null → still track streaks, just can't DM
    const first = firstNameOf(cand.fullName);
    const model = a.creator.name;
    const mgr = a.role.manager;
    const mgrRef = mgr ? `${mgr.name}${mgr.telegramHandle ? ` (${mgr.telegramHandle})` : ""}` : "your manager";

    const clicksToday = todayClickBy.get(a.userId) ?? 0;
    const msgsToday = msgsBy.get(a.user.candidateId) ?? 0;
    const activeToday = clicksToday > 0 || msgsToday > 0;

    const alreadyCountedToday = a.lastActiveDay ? dayDiff(today, a.lastActiveDay) === 0 : false;
    const wasActiveYesterday = a.lastActiveDay ? dayDiff(today, a.lastActiveDay) === 1 : false;
    // How long they've been quiet (from last activity, or from hire if never active).
    const quietDays = a.lastActiveDay ? dayDiff(today, a.lastActiveDay) : dayDiff(today, a.startDate);

    // ---- update streak state (once per day) ----
    let activeStreak = a.activeStreak;
    let bestStreak = a.bestStreak;
    if (activeToday && !alreadyCountedToday) {
      activeStreak = wasActiveYesterday ? a.activeStreak + 1 : 1;
      bestStreak = Math.max(bestStreak, activeStreak);
    } else if (!activeToday && !wasActiveYesterday && !alreadyCountedToday) {
      activeStreak = 0; // streak broken (bestStreak preserved for the comeback)
    }
    await prisma.assignment.update({
      where: { id: a.id },
      data: {
        activeStreak,
        bestStreak,
        ...(activeToday && !alreadyCountedToday ? { lastActiveDay: today } : {}),
      },
    });

    // ---- decide whether to say something (never twice in a day) ----
    const coachedToday = a.lastCoachedDay ? dayDiff(today, a.lastCoachedDay) === 0 : false;
    if (coachedToday) continue;

    const { rank, size } = rankOf(row);
    const weekAvgDaily = row.weekC / 7;
    const strong = clicksToday >= Math.max(3, weekAvgDaily * 1.5);
    const streakMilestone = [3, 7, 14, 30].includes(activeStreak);

    let body: string | null = null;
    let templateKey = "";
    let didEscalate = false;

    if (activeToday) {
      const comingBack = quietDays >= 2 && a.lastActiveDay != null; // active today after a dry spell
      if (comingBack) {
        body =
          `👋 Great to see you back, ${first}! Fresh start today — let's rebuild that streak. ` +
          `Get a couple of posts up and your link in the comments, and I'll check in later 🙌`;
        templateKey = "coach_comeback";
      } else if (rank === 1 && size > 1 && clicksToday > 0) {
        body =
          `🔥 ${first}, ${clicksToday} click${clicksToday === 1 ? "" : "s"} on your link today — that's TOP of ${model}'s ${platformLabel(platform)} pod. ` +
          (activeStreak >= 3 ? `${activeStreak} days on the trot${activeStreak === bestStreak ? " — a personal best!" : ""}. ` : "") +
          `Keep exactly that rhythm 💪`;
        templateKey = "coach_praise_top";
        praised++;
      } else if (strong || streakMilestone) {
        body =
          `💪 Nice one ${first} — ${clicksToday} click${clicksToday === 1 ? "" : "s"} today` +
          (size > 1 ? `, #${rank} of ${size} in ${model}'s ${platformLabel(platform)} pod` : "") +
          `. ` +
          (streakMilestone ? `That's a ${activeStreak}-day streak 🔥 ` : "") +
          `Keep it going!`;
        templateKey = "coach_praise";
        praised++;
      } else {
        continue; // steady + active → leave them be (no nagging)
      }
    } else {
      // inactive today
      if (quietDays <= 1) {
        // brand-new hires get a day's grace before any nudge
        if (a.lastActiveDay == null && dayDiff(today, a.startDate) < 2) continue;
        body =
          `👀 Quiet day on your link, ${first} — you about? Let's get a few posts up and your link in your bio/comments. ` +
          `Want me to resend today's content drive?`;
        templateKey = "coach_nudge1";
      } else if (quietDays === 2) {
        body =
          `Hey ${first}, two quiet days now — everything ok? A couple of posts today gets you back on track. ` +
          `${mgrRef} is here if you're stuck 🙏`;
        templateKey = "coach_nudge2";
      } else {
        // 3+ days dark → escalate to the manager/ops, and message the VA every
        // other day (so we don't pile on daily).
        await sendOpsAlert(
          `⚠ COACH: ${cand.fullName} (${model}/${platformLabel(platform)}) — ${quietDays}d no activity. ` +
            (mgr ? `Manager ${mgrRef} please check in.` : "No manager set — check in.")
        );
        escalated++;
        didEscalate = true;
        if (quietDays % 2 === 1) {
          body =
            `${first}, I've not seen any activity from you in ${quietDays} days — everything alright? ` +
            `No stress at all, just reply and let's get you moving again. ${mgrRef} can help too 🙏`;
          templateKey = "coach_dark";
        }
      }
    }

    if (body && chatId) {
      await logOut(a.user.candidateId, chatId, body, templateKey);
      await prisma.assignment.update({ where: { id: a.id }, data: { lastCoachedDay: today } });
      coached++;
    } else if (didEscalate) {
      // escalation counts as handled even if we didn't DM the VA this cycle
      await prisma.assignment.update({ where: { id: a.id }, data: { lastCoachedDay: today } });
    }
  }

  return { coached, escalated, praised };
}
