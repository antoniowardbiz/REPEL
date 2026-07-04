// Self-improving loop: once a week the bot reads what actually happened — the
// questions VAs asked, where candidates dropped off, what got flagged — and asks
// Claude to surface the top recurring frictions with a concrete fix for each,
// then DMs YOU those suggestions on the ops channel. The system tells you how to
// make it better instead of you having to spot it. Nothing changes on its own;
// you decide what to act on.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { sendOpsAlert } from "./telegram";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const DAY = 86_400_000;

function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && (process.env.AI_SUPPORT ?? "1") !== "0";
}

/** Gather a week of real signal: VA questions + funnel + flags + delivery health. */
async function gatherSignal() {
  const weekAgo = new Date(Date.now() - 7 * DAY);
  const [inbound, candidates, activeVAs, hiresThisWeek, openFlags, failed, quietRows] = await Promise.all([
    prisma.message.findMany({
      where: { direction: "inbound", createdAt: { gte: weekAgo } },
      select: { body: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.candidate.count(),
    prisma.assignment.count({ where: { status: { in: ["probation", "active"] } } }),
    prisma.assignment.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.opsFlag.groupBy({ by: ["kind"], where: { status: "open" }, _count: { _all: true } }),
    prisma.message.count({ where: { direction: "outbound", status: "failed", createdAt: { gte: weekAgo } } }),
    prisma.assignment.findMany({
      where: { status: { in: ["probation", "active"] } },
      select: { lastActiveDay: true },
    }),
  ]);
  const today = new Date();
  const quiet = quietRows.filter(
    (a) => !a.lastActiveDay || (today.getTime() - a.lastActiveDay.getTime()) / DAY >= 2
  ).length;
  const flagsByKind = Object.fromEntries(openFlags.map((f) => [f.kind, f._count._all]));
  return {
    questions: inbound.map((m) => (m.body || "").slice(0, 200)).filter(Boolean),
    stats: { candidates, activeVAs, hiresThisWeek, quiet, failedMessages: failed, flagsByKind },
  };
}

type Suggestion = { issue: string; suggestion: string; evidence?: string };

async function askClaude(signal: Awaited<ReturnType<typeof gatherSignal>>): Promise<Suggestion[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const tool: Anthropic.Tool = {
    name: "suggest",
    description: "Return the top recurring frictions and a concrete fix for each.",
    input_schema: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              issue: { type: "string", description: "the recurring friction, in one line" },
              suggestion: { type: "string", description: "a specific, concrete change to make (name the exact thing)" },
              evidence: { type: "string", description: "what in the data points to it (e.g. 'asked by ~5 VAs')" },
            },
            required: ["issue", "suggestion"],
          },
        },
      },
      required: ["suggestions"],
    },
  };
  const system =
    "You are the operations analyst for SWIFT, a system that recruits, onboards and manages social-media VAs for an agency. " +
    "You are given a week of real VA messages and operating metrics. Identify the TOP 3–5 recurring frictions or points of confusion, " +
    "and for each give ONE specific, concrete improvement the operator could make (name the exact change, e.g. 'add the pay date to the onboarding welcome message'). " +
    "Prefer changes to messaging, onboarding, or the bot's automatic replies. Be brief and practical. If the week was quiet with nothing notable, return an empty list.";
  const user =
    `METRICS: ${JSON.stringify(signal.stats)}\n\n` +
    `VA MESSAGES THIS WEEK (most recent first, sampled):\n` +
    signal.questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: "suggest" },
    messages: [{ role: "user", content: user.slice(0, 12000) }],
  });
  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return [];
  const out = (block.input as { suggestions?: Suggestion[] }).suggestions;
  return Array.isArray(out) ? out.slice(0, 6) : [];
}

/**
 * Run the weekly self-improvement pass and DM the operator the suggestions.
 * No-ops quietly if AI is off or there's too little to analyse.
 */
export async function runSelfImprovement(): Promise<{ ran: boolean; suggestions: number; message?: string }> {
  const signal = await gatherSignal();
  if (signal.questions.length < 5) {
    return { ran: false, suggestions: 0, message: "too little activity to analyse this week" };
  }
  if (!aiEnabled()) {
    // Without AI we can't cluster themes — send the raw signal so it's still useful.
    const f = signal.stats.flagsByKind;
    await sendOpsAlert(
      `🧠 SWIFT weekly review (AI off — set ANTHROPIC_API_KEY for suggestions)\n` +
        `• ${signal.questions.length} VA messages · ${signal.stats.hiresThisWeek} hired · ${signal.stats.activeVAs} active\n` +
        `• ${signal.stats.quiet} VA(s) quiet 2+ days · ${signal.stats.failedMessages} failed messages\n` +
        `• open flags: ${Object.keys(f).length ? Object.entries(f).map(([k, v]) => `${k} ${v}`).join(", ") : "none"}`
    );
    return { ran: true, suggestions: 0, message: "sent raw signal (AI off)" };
  }

  let suggestions: Suggestion[] = [];
  try {
    suggestions = await askClaude(signal);
  } catch (e) {
    console.error("[self-improve] AI call failed:", e);
    return { ran: false, suggestions: 0, message: "AI call failed" };
  }
  if (suggestions.length === 0) {
    await sendOpsAlert(`🧠 SWIFT weekly review — quiet week, no changes suggested. (${signal.questions.length} VA messages reviewed.)`);
    return { ran: true, suggestions: 0 };
  }

  const body =
    `🧠 SWIFT weekly improvement ideas (${signal.questions.length} VA messages reviewed)\n\n` +
    suggestions
      .map(
        (s, i) =>
          `${i + 1}. ${s.issue}\n   → ${s.suggestion}` + (s.evidence ? `\n   (${s.evidence})` : "")
      )
      .join("\n\n") +
    `\n\nTell Claude Code to build any of these and it's done.`;
  await sendOpsAlert(body);
  return { ran: true, suggestions: suggestions.length };
}
