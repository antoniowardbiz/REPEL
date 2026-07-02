import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { submitTrial, deliverStageMessage } from "@/lib/services";
import { sendOpsAlert, sendTelegramMessage } from "@/lib/telegram";
import { ROLE_PLATFORM } from "@/lib/roles-config";
import { handleCandidateMessage } from "@/lib/ai-support";

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

  try {
    // ── /start <token> deep link ────────────────────────────────────────────
    const startMatch = typeof text === "string" ? text.match(/^\/start(?:\s+(\S+))?/i) : null;
    if (startMatch) {
      const token = startMatch[1];
      let cand = token ? await prisma.candidate.findUnique({ where: { startToken: token } }) : null;
      if (!cand && username) cand = await prisma.candidate.findFirst({ where: { telegramHandle: username } });
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
    let candidate = await prisma.candidate.findFirst({ where: { telegramChatId: chatId } });
    let firstBind = false;
    if (!candidate && username) {
      candidate = await prisma.candidate.findFirst({ where: { telegramHandle: username } });
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

    // ── submission during a live trial (intent-gated) ────────────────────────
    const links = text ? Array.from(text.matchAll(URL_RE)).map((m) => m[0]) : [];
    const saidSubmit = text ? SUBMIT_RE.test(text) : false;
    let handled = firstBind; // first-bind already got their stage message
    if (links.length > 0 || saidSubmit) {
      const app = await prisma.application.findFirst({
        where: { candidateId: candidate.id, stage: { in: ["TRIAL_READY", "TRIAL_ACTIVE"] } },
        orderBy: { stageChangedAt: "desc" },
        include: { role: true },
      });
      if (app) {
        const platform = ROLE_PLATFORM[app.role.key];
        const onPlatform = links.some((u) => linkOnPlatform(u, platform));
        // Real submission only on clear intent: a link on the role's own
        // platform, OR an explicit "submit/done" that includes a link. A stray
        // off-platform link (portfolio, progress pic, signature) is just history.
        if (onPlatform || (saidSubmit && links.length > 0)) {
          await submitTrial(app.id, links);
          handled = true;
        } else if (saidSubmit && links.length === 0) {
          // Said "done" but attached no link — nudge, don't submit.
          await sendTelegramMessage(
            chatId,
            "Almost! Reply with the link to your trial post to submit it ✅"
          );
          handled = true;
        }
        // else: off-platform link, no submit intent — recorded as history only.
      }
    }

    // ── AI support: answer everything else, 24/7 ─────────────────────────────
    // Whatever wasn't a deep link, a submission, or a nudge gets the support
    // agent: it answers from the candidate's real context or escalates to ops.
    // Fully skipped when ANTHROPIC_API_KEY is unset.
    if (!handled && text && text.trim().length > 0) {
      await handleCandidateMessage(candidate.id, chatId, text);
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
