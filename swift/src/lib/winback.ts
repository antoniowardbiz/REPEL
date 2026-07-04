// Never waste a VA. Anyone who went through the application but stalled — trial
// expired, or a Reddit candidate who never got moving — gets an escalating,
// spaced-out win-back: a warm nudge, the pay/commission incentive, and a real
// testimonial, ending in a clear "you can still start" CTA. Capped so it
// motivates without ever becoming spam. The rescue path already works: an
// expired candidate who sends SUBMIT (with their post link) is hired on the spot.

import { prisma } from "./db";
import { sendTelegramMessage, sendOpsAlert } from "./telegram";
import { firstNameOf } from "./templates";
import { ROLE_PAY, ROLE_PLATFORM } from "./roles-config";

const DAY = 86_400_000;

// Tunables (env-overridable). Chase for ~a week or so, a few days apart, then stop.
const WINBACK_MAX = Number(process.env.WINBACK_MAX ?? 3); // attempts before we stop
const WINBACK_GAP_DAYS = Number(process.env.WINBACK_GAP_DAYS ?? 3); // days between touches
const WINBACK_LOOKBACK_DAYS = Number(process.env.WINBACK_LOOKBACK_DAYS ?? 30); // ignore ancient apps

const HIRED_STAGES = ["ONBOARDING", "ACTIVE"];

// Testimonials shown from attempt 2 onward. EDIT THESE with real quotes from your
// own VAs/clients — that's what converts. Kept generic + honest by default (no
// invented names or hard figures presented as fact). Rotated by attempt.
const TESTIMONIALS = [
  "“The base pay covered me straight away, then the commission started stacking on top. Easiest money I make from my phone.” — a VA on the team",
  "“First couple of days felt slow, then it clicked. Now I just keep my link out there and the subs come in.” — a VA on the team",
  "“I nearly didn’t finish setting up. So glad I pushed through — wish I’d started sooner.” — a VA on the team",
];

function incentiveLine(roleKey: string): string {
  const pay = ROLE_PAY[roleKey];
  return pay ? `💰 Reminder of what’s on the table: ${pay}.` : "";
}

/** Role-appropriate call to action — worded to hit the bot's existing handlers
 *  so a reply actually restarts them (no dead-end commands). */
function ctaLine(roleKey: string): string {
  const platform = ROLE_PLATFORM[roleKey];
  if (platform === "reddit") {
    // Routes through the account gate (YES/NO) which sets them up + hands off.
    return "Just reply here — YES if you’ve already got a Reddit account, or NO and I’ll set you up with one and get you going 🚀";
  }
  // X / default: the SUBMIT rescue path hires them immediately.
  return "Ready? Post your content and send the link here with the word SUBMIT — I’ll take it and get you started right away 🚀";
}

function composeMessage(attempt: number, firstName: string, roleName: string, roleKey: string): string {
  const incentive = incentiveLine(roleKey);
  const cta = ctaLine(roleKey);
  if (attempt === 1) {
    return (
      `Hey ${firstName} — I don’t want you to miss out on your ${roleName} spot 🙌 ` +
      `It’s still open for you.\n\n${incentive}\n\n${cta}`
    );
  }
  if (attempt === 2) {
    const t = TESTIMONIALS[1 % TESTIMONIALS.length];
    return (
      `Hey ${firstName} — still keeping your ${roleName} spot for you 🙏\n\n` +
      `${t}\n\n${incentive}\n\n${cta}`
    );
  }
  // Final attempt — strongest push, then we stop.
  const t = TESTIMONIALS[2 % TESTIMONIALS.length];
  return (
    `Hey ${firstName} — last check-in from me 👋 I’d hate for you to leave money on the table.\n\n` +
    `${t}\n\n${incentive}\n\n${cta}\n\n(If now’s not the time, no worries — message me whenever you’re ready.)`
  );
}

/**
 * Run one win-back pass. For each stalled/expired candidate who hasn't converted
 * and isn't over the attempt cap, send the next escalation if enough time has
 * passed since the last touch. Safe to run daily — spacing + cap prevent spam.
 */
export async function runWinback(): Promise<{ sent: number; skipped: number; done: number }> {
  const cutoff = new Date(Date.now() - WINBACK_LOOKBACK_DAYS * DAY);
  // Candidates whose latest trial expired or who stalled at the Reddit account
  // step, whose application hasn't reached a hired stage.
  const trials = await prisma.trial.findMany({
    where: {
      status: { in: ["expired", "account_check", "with_manager"] },
      createdAt: { gte: cutoff },
      application: { stage: { notIn: [...HIRED_STAGES, "ARCHIVED", "REJECTED"] } },
    },
    include: { application: { include: { candidate: true, role: true } } },
    orderBy: { createdAt: "desc" },
  });

  // One (most recent) trial per candidate.
  const byCandidate = new Map<string, (typeof trials)[number]>();
  for (const t of trials) {
    const cid = t.application.candidateId;
    if (!byCandidate.has(cid)) byCandidate.set(cid, t);
  }

  let sent = 0;
  let skipped = 0;
  let done = 0;
  const now = Date.now();

  for (const t of byCandidate.values()) {
    const cand = t.application.candidate;
    if (!cand.telegramChatId) {
      skipped++;
      continue;
    }
    // Belt-and-braces: if they somehow already have an active assignment, they
    // converted — never chase a working VA.
    const active = await prisma.assignment.count({
      where: { user: { candidateId: cand.id }, status: { in: ["probation", "active"] } },
    });
    if (active > 0) {
      skipped++;
      continue;
    }

    // How many win-backs already sent, and when was the last touch of any kind
    // (expiry DM, manager nudge, or a prior win-back)?
    const priorTouches = await prisma.message.findMany({
      where: {
        candidateId: cand.id,
        direction: "outbound",
        templateKey: { in: ["winback_1", "winback_2", "winback_3", "trial_expired_reengage", "manager_nudge"] },
      },
      select: { templateKey: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const winbacksSent = priorTouches.filter((m) => (m.templateKey || "").startsWith("winback_")).length;
    if (winbacksSent >= WINBACK_MAX) {
      done++;
      continue;
    }
    const lastTouch = priorTouches[0]?.createdAt?.getTime() ?? 0;
    if (lastTouch && now - lastTouch < WINBACK_GAP_DAYS * DAY) {
      skipped++;
      continue;
    }

    const attempt = winbacksSent + 1;
    const body = composeMessage(attempt, firstNameOf(cand.fullName), t.application.role.displayName, t.application.role.key);
    const r = await sendTelegramMessage(cand.telegramChatId, body);
    await prisma.message.create({
      data: {
        candidateId: cand.id,
        applicationId: t.applicationId,
        direction: "outbound",
        channel: "telegram",
        templateKey: `winback_${attempt}`,
        body,
        status: r.status,
      },
    });
    sent++;
  }

  if (sent > 0) {
    await sendOpsAlert(
      `🔁 Win-back: re-engaged ${sent} stalled VA${sent === 1 ? "" : "s"} (incentive + testimonial). ` +
        `${done} reached the ${WINBACK_MAX}-touch cap and were left alone.`
    );
  }
  return { sent, skipped, done };
}
