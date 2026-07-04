import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { submitTrial, deliverStageMessage, routeToManagerForAccount, selectRole } from "@/lib/services";
import { sendOpsAlert, sendTelegramMessage } from "@/lib/telegram";
import { ROLE_PLATFORM } from "@/lib/roles-config";
import { handleCandidateMessage } from "@/lib/ai-support";
import { totp, totpSecondsRemaining, parse2FASecret } from "@/lib/totp";
import { classifyVaSignal, raiseVaFlag } from "@/lib/signals";

// POST /api/telegram/webhook?secret=... — inbound Telegram updates.
//
//  - `/start <token>` (the apply-form deep link) binds the candidate's chat id
//    and instantly delivers the message for their current stage (first-touch,
//    training, or brief) — closing the "bots can't DM first" gap.
//  - First DM from a known @username also binds the chat id + delivers.
//  - During a live trial, a submission is recognised only on clear INTENT: a
//    link on the role's own platform (x.com / reddit.com …) or an explicit
//    "submit/done". A stray link never instant-hires anyone.
//  - Everything else is recorded as inbound history.
//
// Always returns 200 so Telegram doesn't retry-storm.

const URL_RE = /\bhttps?:\/\/[^\s]+/gi;
const SUBMIT_RE = /\b(submit|submitted|done|finished|complete[d]?)\b/i;
// Account-check answers (has an account to use, or needs one set up).
const YES_RE = /\b(yes|yep|yeah|yup|ya|i do|i have|have one|got one|got it|ready|affirmative|sure)\b/i;
const NO_RE = /\b(no|nope|nah|don'?t|do not|haven'?t|need (?:one|an account|setup|set up)|not yet|new account)\b/i;
const ok = () => NextResponse.json({ ok: true });

// Which hostnames count as "on the role's platform" for a real submission.
const PLATFORM_HOSTS: Record<string, string[]> = {
  x: ["x.com", "twitter.com", "t.co"],
  reddit: ["reddit.com", "redd.it"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
};

function linkOnPlatform(rawUrl: string, platform?: string): boolean {
  const hosts = platform ? PLATFORM_HOSTS[platform] : undefined;
  if (!hosts) return false;
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
    return hosts.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

/** Send a bot reply to the candidate AND record it, so the inline prompts that
 *  aren't template-driven still show in the Conversations feed and the Telegram
 *  mirror (nothing the bot says goes unlogged). */
async function replyAndLog(candidateId: string, chatId: string, body: string, templateKey: string) {
  const r = await sendTelegramMessage(chatId, body);
  await prisma.message.create({
    data: { candidateId, direction: "outbound", channel: "telegram", templateKey, body, status: r.status },
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: any = {};
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  const msg = update.message ?? update.edited_message;
  const text: string | undefined = msg?.text;
  const chatId: string | undefined = msg?.chat?.id ? String(msg.chat.id) : undefined;
  const username: string | undefined = msg?.from?.username ? `@${msg.from.username}` : undefined;
  if (!chatId) return ok();

  // Utility: reply with this chat's id so the operator can grab a group's id for
  // MIRROR_TELEGRAM_CHAT_ID (add the bot to a group, send /chatid). Works anywhere.
  if (typeof text === "string" && /^\/(chatid|id)\b/i.test(text.trim())) {
    await sendTelegramMessage(chatId, `This chat's ID is: ${chatId}\n\nPaste it into MIRROR_TELEGRAM_CHAT_ID to mirror all conversations here.`);
    return ok();
  }

  try {
    // ── /start <token> deep link ────────────────────────────────────────────
    const startMatch = typeof text === "string" ? text.match(/^\/start(?:\s+(\S+))?/i) : null;
    if (startMatch) {
      const token = startMatch[1];
      let cand = token ? await prisma.candidate.findUnique({ where: { startToken: token } }) : null;
      if (!cand && username)
        cand = await prisma.candidate.findFirst({
          where: { telegramHandle: username },
          orderBy: { createdAt: "desc" }, // newest application wins if they re-applied
        });
      if (cand) {
        await prisma.candidate.update({ where: { id: cand.id }, data: { telegramChatId: chatId } });
        await prisma.message.create({
          data: { candidateId: cand.id, direction: "inbound", channel: "telegram", body: text!, status: "received" },
        });
        await deliverStageMessage(cand.id); // fire the queued auto-reply now
      } else {
        await prisma.notification.create({
          data: { type: "telegram_unknown_start", channel: "ops", payload: JSON.stringify({ chatId, username, token }) },
        });
      }
      return ok();
    }

    // ── regular message: bind chat id (deliver on first bind) ────────────────
    // Resolve to the MOST RECENT candidate for this chat/handle. During testing
    // (and real re-applications) one Telegram account can map to several
    // candidate records; without an order the bot could answer as a stale one,
    // dropping the reply through to the AI agent instead of the account step.
    let candidate = await prisma.candidate.findFirst({
      where: { telegramChatId: chatId },
      orderBy: { createdAt: "desc" },
    });
    let firstBind = false;
    if (!candidate && username) {
      candidate = await prisma.candidate.findFirst({
        where: { telegramHandle: username },
        orderBy: { createdAt: "desc" },
      });
      if (candidate) {
        await prisma.candidate.update({ where: { id: candidate.id }, data: { telegramChatId: chatId } });
        firstBind = true;
      }
    }
    if (!candidate) {
      await prisma.notification.create({
        data: { type: "telegram_unknown_sender", channel: "ops", payload: JSON.stringify({ chatId, username, text }) },
      });
      await sendOpsAlert(`❓ Telegram message from unknown sender ${username ?? chatId}: ${(text ?? "").slice(0, 120)}`);
      return ok();
    }

    await prisma.message.create({
      data: {
        candidateId: candidate.id,
        direction: "inbound",
        channel: "telegram",
        body: text ?? "(non-text message)",
        status: "received",
        meta: JSON.stringify({ chatId, username }),
      },
    });
    await prisma.activityEvent.create({
      data: { candidateId: candidate.id, type: "checkin_reply", payload: JSON.stringify({ at: Date.now() }) },
    });

    if (firstBind) await deliverStageMessage(candidate.id);

    // Pending managed-role account step? While a candidate is still answering
    // the account question (account_check) or with the manager (with_manager),
    // a posted link is NOT a trial submission — the account must be set up +
    // warmed first. Without this, "YES, it's reddit.com/u/me" would instant-hire
    // a cold account, the exact thing the manager step exists to prevent.
    const accountGate = text
      ? await prisma.trial.findFirst({
          where: {
            status: { in: ["account_check", "with_manager"] },
            application: {
              candidateId: candidate.id,
              stage: "TRIAL_READY",
              role: { managerUserId: { not: null } },
            },
          },
          orderBy: { createdAt: "desc" },
          include: { application: true },
        })
      : null;
    const atAccountCheck = accountGate?.status === "account_check";

    // ── submission during a live trial (SUBMIT-intent gated) ─────────────────
    const links = text ? Array.from(text.matchAll(URL_RE)).map((m) => m[0]) : [];
    const saidSubmit = text ? SUBMIT_RE.test(text) : false;
    let handled = firstBind; // first-bind already got their stage message
    // Never treat a message as a submission while they're still on the account
    // question — that belongs to the YES/NO gate below.
    if (!atAccountCheck && (links.length > 0 || saidSubmit)) {
      const app = await prisma.application.findFirst({
        where: { candidateId: candidate.id, stage: { in: ["TRIAL_READY", "TRIAL_ACTIVE"] } },
        orderBy: { stageChangedAt: "desc" },
        include: { role: true },
      });
      if (app) {
        const platform = ROLE_PLATFORM[app.role.key];
        const onPlatform = links.some((u) => linkOnPlatform(u, platform));
        // A hire now requires EXPLICIT intent (the word SUBMIT + a link) — the
        // brief tells them to. A bare on-platform link no longer auto-hires (that
        // used to hire an X VA who merely shared a viral link, or a Reddit VA who
        // pasted their profile). We ask them to confirm instead.
        if (saidSubmit && links.length > 0) {
          await submitTrial(app.id, links);
          handled = true;
        } else if (saidSubmit && links.length === 0) {
          await replyAndLog(candidate.id, chatId, "Almost! Reply with the link to your trial post to submit it ✅", "submit_nudge");
          handled = true;
        } else if (onPlatform) {
          // On-platform link, no SUBMIT word — confirm intent rather than hiring.
          await replyAndLog(
            candidate.id,
            chatId,
            "Got your link! If that's your finished trial post, reply with the word SUBMIT and the link to send it in ✅",
            "submit_confirm"
          );
          handled = true;
        }
        // else: off-platform link, no intent — recorded as history only.
      }
    }

    // ── Account check: candidate answering the YES/NO account question ───────
    if (!handled && text && atAccountCheck && accountGate) {
      // Both answers hand off to the manager — she assesses the account and
      // assigns the path (posting vs warm-up). Check NO first: "i don't have
      // one" contains "have one", so a negative must beat the affirmative.
      if (NO_RE.test(text)) {
        await routeToManagerForAccount(accountGate.applicationId, false); // no account → set up + warm
        handled = true;
      } else if (YES_RE.test(text)) {
        await routeToManagerForAccount(accountGate.applicationId, true); // has account → assess & start
        handled = true;
      } else {
        await replyAndLog(
          candidate.id,
          chatId,
          "Just reply YES if you have a Reddit account to use, or NO if you need one set up 🙂",
          "account_reask"
        );
        handled = true;
      }
    }

    // ── Role selection: candidate replying to "which role + why?" (no app yet)
    // Closes the dead-end where someone who picked "not sure yet" (or landed
    // role-less) answers the first-touch question and is ignored forever.
    if (!handled && text) {
      const hasApp = await prisma.application.findFirst({ where: { candidateId: candidate.id } });
      if (!hasApp) {
        const wantsReddit = /\breddit\b/i.test(text);
        const wantsX = /\b(x|twitter|tweet)\b/i.test(text);
        let roleKey: string | null = null;
        if (wantsReddit && !wantsX) roleKey = "reddit_va";
        else if (wantsX && !wantsReddit) roleKey = "x_va";
        if (roleKey) {
          await selectRole(candidate.id, roleKey, text); // creates the application + fires training
          handled = true;
        } else {
          const ask = "Which is your strong point — reply X (Twitter) or Reddit and I'll get you started 🙂";
          const r = await sendTelegramMessage(chatId, ask);
          await prisma.message.create({
            data: {
              candidateId: candidate.id,
              direction: "outbound",
              channel: "telegram",
              templateKey: "role_prompt",
              body: ask,
              status: r.status,
            },
          });
          handled = true;
        }
      }
    }

    // ── 2FA login code: a hired VA asking for their account's authenticator code
    // They message "code" / "2fa" / "otp" and the bot generates the current TOTP
    // for the account they hold and replies with it — no authenticator app on
    // their end. (Same automation as the outreach side of the business.)
    if (!handled && text && /^\/?(code|2fa|otp|login\s*code)\b/i.test(text.trim())) {
      const user = await prisma.user.findFirst({ where: { candidateId: candidate.id } });
      const grant = user
        ? await prisma.accessGrant.findFirst({
            where: { userId: user.id, status: "active", account: { login: { not: null } } },
            orderBy: { grantedAt: "desc" },
            include: { account: true },
          })
        : null;
      const secret = parse2FASecret(grant?.account.login);
      if (secret) {
        const code = totp(secret);
        const left = totpSecondsRemaining();
        await replyAndLog(
          candidate.id,
          chatId,
          `🔐 Your login code: ${code}\n(good for ~${left}s — if it expires just message "code" again)`,
          "twofa_code"
        );
      } else {
        await replyAndLog(
          candidate.id,
          chatId,
          `I don't have a login code on file for your account yet — your manager will sort it 🙏`,
          "twofa_none"
        );
      }
      handled = true;
    }

    // ── "link": a VA asking for their personal promo link again. VAs lose it
    // constantly, so let them self-serve instead of pinging the operator.
    if (!handled && text && /^\/?(link|my\s*link)\b/i.test(text.trim())) {
      const user = await prisma.user.findFirst({ where: { candidateId: candidate.id } });
      const asg = user
        ? await prisma.assignment.findFirst({
            where: { userId: user.id, status: { in: ["probation", "active"] } },
            orderBy: { createdAt: "desc" },
            include: { role: true },
          })
        : null;
      if (asg?.promoLink) {
        const platform = ROLE_PLATFORM[asg.role.key];
        const placement =
          platform === "x"
            ? "Put it in your X bio AND drop it in the comments of EVERY post."
            : platform === "reddit"
              ? "Put it in your Reddit bio so it sits on every post."
              : "Keep it in your bio so fans can always find it.";
        await replyAndLog(
          candidate.id,
          chatId,
          `🔗 Here's your personal promo link — post THIS to bring subs, it's tracked to you:\n\n${asg.promoLink}\n\n📍 ${placement}`,
          "link_resend"
        );
      } else {
        await replyAndLog(
          candidate.id,
          chatId,
          `You don't have a promo link set yet — your manager will sort it 🙏`,
          "link_none"
        );
      }
      handled = true;
    }

    // ── VA trouble signals: content run out / account banned ─────────────────
    // Catch "I'm out of content" or "my account got banned" BEFORE the general
    // AI so it becomes a visible flag on the dashboard + an ops alert, not just
    // a chat reply that's forgotten.
    if (!handled && text && text.trim().length > 0) {
      const sig = classifyVaSignal(text);
      if (sig) {
        const { reply } = await raiseVaFlag(candidate.id, sig, text);
        await replyAndLog(candidate.id, chatId, reply, `flag_${sig}`);
        handled = true;
      }
    }

    // ── AI support: answer everything else, 24/7 ─────────────────────────────
    // Whatever wasn't a deep link, a submission, an account answer, or a nudge
    // gets the support agent: it answers from the candidate's real context or
    // escalates to ops.
    if (!handled && text && text.trim().length > 0) {
      const outcome = await handleCandidateMessage(candidate.id, chatId, text);
      // Never leave a candidate in silence when the AI couldn't run (key unset,
      // over the daily cap, or errored). Send a human-handoff line and alert ops
      // so someone actually replies.
      if (outcome.action === "off" || outcome.action === "capped" || outcome.action === "error") {
        const fallback = "Thanks for your message 🙏 A team member will get back to you shortly.";
        const r = await sendTelegramMessage(chatId, fallback);
        await prisma.message.create({
          data: {
            candidateId: candidate.id,
            direction: "outbound",
            channel: "telegram",
            templateKey: "human_fallback",
            body: fallback,
            status: r.status,
          },
        });
        await sendOpsAlert(
          `🙋 Candidate needs a human (AI ${outcome.action}) — ${username ?? chatId}: "${(text ?? "").slice(0, 160)}"`
        );
      }
    }
  } catch (e) {
    console.error("telegram webhook error:", e);
    // Make failures VISIBLE instead of swallowing them (a swallowed error here
    // used to mean a lost submission with no trace).
    await sendOpsAlert(
      `⚠ Telegram webhook error for ${username ?? chatId}: ${String((e as any)?.message ?? e).slice(0, 200)}`
    ).catch(() => {});
  }

  return ok();
}
