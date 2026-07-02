// AI support agent: answers candidate DMs 24/7 from their real pipeline
// context (role, stage, model, drive, deadline, pay, training material) so the
// operator stays hands-off. Anything sensitive or out-of-scope is ESCALATED to
// the ops channel instead of answered.
//
// Graceful fallback: with no ANTHROPIC_API_KEY nothing is sent (messages are
// still recorded as before) — the pipeline is unaffected.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { sendTelegramMessage, sendOpsAlert } from "./telegram";
import { ROLE_PAY, ROLE_TARGETS } from "./roles-config";
import { deadlineLabel } from "./ui";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
// Cost/abuse guard: max AI replies per candidate per day.
const MAX_REPLIES_PER_DAY = Number(process.env.AI_SUPPORT_MAX_PER_DAY || 15);

export function aiSupportEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && (process.env.AI_SUPPORT ?? "1") !== "0";
}

/** Everything the agent is allowed to know, assembled from live data. */
async function buildSupportContext(candidateId: string): Promise<string | null> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: {
      applications: {
        orderBy: { appliedAt: "desc" },
        take: 1,
        include: {
          role: { include: { defaultCreator: true, manager: true, trainingModule: true } },
          trials: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!candidate) return null;
  const app = candidate.applications[0];
  if (!app) return null;

  const assignment = await prisma.assignment.findFirst({
    where: { user: { candidateId }, status: { in: ["probation", "active"] } },
    orderBy: { createdAt: "desc" },
    include: { creator: true },
  });
  const creator = assignment?.creator ?? app.role.defaultCreator;
  // Per-role drive when set, falling back to the model's general drive.
  let drive = creator?.contentDriveUrl || "";
  try {
    const drives = creator?.contentDrives ? JSON.parse(creator.contentDrives) : {};
    if (drives?.[app.role.key]) drive = drives[app.role.key];
  } catch {
    /* keep fallback */
  }
  const trial = app.trials[0] ?? null;
  const dl = trial?.deadlineAt && trial.status === "active" ? deadlineLabel(trial.deadlineAt) : null;
  const training = app.role.trainingModule?.content?.slice(0, 2500) ?? "";
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");

  return `CANDIDATE
Name: ${candidate.fullName}
Role: ${app.role.displayName}
Pipeline stage: ${app.stage} (APPLIED→TRAINING→TRIAL→SUBMITTED→ACTIVE=hired)
${trial ? `Trial status: ${trial.status}${dl ? ` — ${dl.text}` : ""}` : "Trial: not started yet"}

THEIR MODEL (the creator they work for)
Model name: ${creator?.name ?? "not assigned yet — assigned automatically when hired"}
Model main page: ${creator?.xMainUrl || "n/a"}
Content drive (what they post FROM): ${drive || "not set — escalate if asked"}
Manager: ${app.role.manager ? `${app.role.manager.name}${app.role.manager.telegramHandle ? ` (${app.role.manager.telegramHandle})` : ""}` : "the operator"}

TERMS
Pay: ${ROLE_PAY[app.role.key] || "confirmed by the manager at onboarding"}
Daily target: ${ROLE_TARGETS[app.role.key]?.label ?? "per the brief"}
Their personal training page: ${candidate.startToken ? `${base}/training/${candidate.startToken}` : "n/a"}

HOW THE PROCESS WORKS (answer from this)
1. Pass the training quiz on their training page → trial unlocks automatically.
2. The trial brief arrives here in Telegram; they do the work on their account.
3. To SUBMIT: send the link to their work here with the word SUBMIT (Reddit/X links count automatically).
4. Submitting = hired: they get a welcome with model, drive, target, pay, group.
5. After hire: hit the daily target, check in with the manager daily, keep the account safe (no nudity on SFW platforms, no password changes, natural pacing, stop + report anything risky like a shadowban).

ROLE TRAINING MATERIAL (excerpt)
${training}`;
}

export type SupportOutcome =
  | { action: "replied"; reply: string }
  | { action: "escalated"; reason: string }
  | { action: "ignored"; reason?: string }
  | { action: "off" | "capped" | "error"; reason?: string };

/**
 * Handle one inbound candidate message. Replies directly on Telegram when the
 * agent is confident, escalates to ops when it shouldn't answer, stays silent
 * on chatter that needs no reply.
 */
export async function handleCandidateMessage(
  candidateId: string,
  chatId: string,
  text: string
): Promise<SupportOutcome> {
  if (!aiSupportEnabled()) return { action: "off" };

  // Daily cap per candidate.
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const today = await prisma.message.count({
    where: { candidateId, templateKey: "ai_support", createdAt: { gte: since } },
  });
  if (today >= MAX_REPLIES_PER_DAY) return { action: "capped" };

  const context = await buildSupportContext(candidateId);
  if (!context) return { action: "ignored", reason: "no context" };

  // Last few messages for conversational continuity.
  const history = await prisma.message.findMany({
    where: { candidateId },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const historyText = history
    .reverse()
    .map((m) => `${m.direction === "inbound" ? "CANDIDATE" : "US"}: ${m.body.slice(0, 300)}`)
    .join("\n");

  const system = `You are the support agent inside SWIFT's Telegram recruitment bot, texting a VA candidate/hire. Personality: professional, warm, brief — 1-4 short sentences, sound human, occasional emoji is fine. Never mention being an AI.

Decision rules:
- "reply": answer questions you can ground in the CONTEXT (process, their stage, model, drive, targets, pay terms shown, how to submit, account safety). Nudge action ("pass your quiz to unlock the trial", "send your link with SUBMIT").
- "escalate": payment disputes/amounts owed, changing pay terms, account bans or lockouts, requests for credentials/2FA/passwords, personal or legal matters, complaints about people, anything the CONTEXT doesn't cover. Do NOT guess.
- "ignore": pure chatter needing no reply (ok, thanks, emoji, greetings already handled).
Never invent links, amounts, or promises not in the CONTEXT. Never send a raw password/credential. Do not re-trigger submissions.`;

  const user = `CONTEXT
${context}

RECENT CONVERSATION
${historyText}

NEW MESSAGE FROM CANDIDATE
"${text.slice(0, 800)}"

Decide: reply, escalate, or ignore — via the respond tool.`;

  const tool: Anthropic.Tool = {
    name: "respond",
    description: "Your decision for this candidate message.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["reply", "escalate", "ignore"] },
        reply: { type: "string", description: "The Telegram message to send (action=reply only). 1-4 short sentences." },
        reason: { type: "string", description: "Why (action=escalate/ignore)." },
      },
      required: ["action"],
    },
  };

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "respond" },
      messages: [{ role: "user", content: user }],
    });
    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return { action: "error", reason: "no tool output" };
    const input = block.input as { action?: string; reply?: string; reason?: string };

    if (input.action === "reply" && typeof input.reply === "string" && input.reply.trim()) {
      const reply = input.reply.trim().slice(0, 1500);
      const r = await sendTelegramMessage(chatId, reply);
      await prisma.message.create({
        data: {
          candidateId,
          direction: "outbound",
          channel: "telegram",
          templateKey: "ai_support",
          body: reply,
          status: r.status,
        },
      });
      return { action: "replied", reply };
    }

    if (input.action === "escalate") {
      const cand = await prisma.candidate.findUnique({ where: { id: candidateId } });
      await sendOpsAlert(
        `🙋 Needs a human — ${cand?.fullName ?? candidateId}: "${text.slice(0, 200)}"${
          input.reason ? ` (${input.reason})` : ""
        }`
      );
      await prisma.notification.create({
        data: {
          type: "support_escalation",
          channel: "ops",
          payload: JSON.stringify({ candidateId, text: text.slice(0, 500), reason: input.reason ?? null }),
        },
      });
      return { action: "escalated", reason: input.reason ?? "" };
    }

    return { action: "ignored", reason: input.reason };
  } catch (e: any) {
    console.error("ai-support error:", e?.message ?? e);
    return { action: "error", reason: String(e?.message ?? e).slice(0, 200) };
  }
}
