import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { submitTrial, deliverStageMessage } from "@/lib/services";
import { sendOpsAlert } from "@/lib/telegram";

// POST /api/telegram/webhook?secret=... — inbound Telegram updates.
//
//  - `/start <token>` (the apply-form deep link) binds the candidate's chat id
//    and instantly delivers the message for their current stage (first-touch,
//    training, or brief) — closing the "bots can't DM first" gap.
//  - First DM from a known @username also binds the chat id + delivers.
//  - A message with URL(s) during a live trial is treated as a submission.
//  - Everything else is recorded as inbound history.
//
// Always returns 200 so Telegram doesn't retry-storm.

const URL_RE = /\bhttps?:\/\/[^\s]+/gi;
const ok = () => NextResponse.json({ ok: true });

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

    // ── submission links during a live trial ─────────────────────────────────
    const links = text ? Array.from(text.matchAll(URL_RE)).map((m) => m[0]) : [];
    if (links.length > 0) {
      const app = await prisma.application.findFirst({
        where: { candidateId: candidate.id, stage: { in: ["TRIAL_READY", "TRIAL_ACTIVE"] } },
        orderBy: { stageChangedAt: "desc" },
      });
      if (app) await submitTrial(app.id, links);
    }
  } catch (e) {
    console.error("telegram webhook error:", e);
  }

  return ok();
}
