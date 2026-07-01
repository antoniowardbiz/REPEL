// AI scoring assist (Phase 3). Given a submitted trial, ask Claude to draft a
// 0–5 score for every rubric criterion (plus any hard-fail flags, a suggested
// tier and a one-line rationale) so the operator reviews and finalizes instead
// of scoring cold. Structured output is forced via a tool call.
//
// Graceful fallback: with no ANTHROPIC_API_KEY the feature reports itself
// unavailable (mirroring the Telegram "simulated" pattern) so the rest of the
// app is unaffected.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { HARD_FAIL_FLAGS } from "./constants";
import { parseCriteria, parseUrls } from "./serialize";

// Default to the most capable model; override with ANTHROPIC_MODEL (e.g.
// claude-sonnet-5 or claude-haiku-4-5) to trade capability for cost.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export type AiDraft = {
  scores: Record<string, number>;
  flags: string[];
  suggested_tier: string | null;
  rationale: string;
};

export type AiDraftResult =
  | { available: true; draft: AiDraft }
  | { available: false; reason: string };

export async function aiDraftScore(trialId: string): Promise<AiDraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { available: false, reason: "AI scoring off — set ANTHROPIC_API_KEY to enable." };

  const trial = await prisma.trial.findUnique({
    where: { id: trialId },
    include: {
      application: { include: { candidate: true, role: { include: { rubric: true } } } },
      scoreCard: true,
      watch: { include: { observations: { orderBy: { capturedAt: "desc" }, take: 5 } } },
    },
  });
  if (!trial) throw new Error("trial not found");

  const criteria = parseCriteria(trial.application.role.rubric?.criteria);
  if (criteria.length === 0) return { available: false, reason: "this role has no rubric to score against." };

  const candidate = trial.application.candidate;
  const role = trial.application.role;
  const urls = parseUrls(trial.submissionUrls);
  const observations = trial.watch?.observations ?? [];

  const criteriaText = criteria
    .map(
      (c) =>
        `- ${c.key} (${c.label}, weight ${c.weight}) — 5: ${c.anchor_5} | 3: ${c.anchor_3} | 1: ${c.anchor_1}`
    )
    .join("\n");
  const flagsText = HARD_FAIL_FLAGS.map((f) => `- ${f.key}: ${f.label}`).join("\n");
  const obsText = observations.length
    ? observations.map((o) => `- ${o.notes ?? o.source}: ${o.metrics}`).join("\n")
    : "none collected";

  const system =
    "You are an expert reviewer for a virtual-assistant recruitment pipeline. You grade a " +
    "candidate's trial submission against a fixed weighted rubric. Score each criterion as an " +
    "integer 0–5, calibrated to the provided anchors. Only set a hard-fail flag when the evidence " +
    "clearly supports it (most submissions have none). Be objective and concise. Return your " +
    "assessment by calling the submit_scores tool.";

  const user = `Role: ${role.displayName}
Candidate: ${candidate.fullName}
Their "why": ${trial.application.whyText ?? "—"}
Account used: ${trial.accountUsed ?? "—"}
Submission links (${urls.length}):
${urls.map((u) => `- ${u}`).join("\n") || "- none"}

Watcher observations (auto-collected):
${obsText}
${trial.scoreCard?.autoRating != null ? `Watcher auto-rating: ${trial.scoreCard.autoRating}/10\n` : ""}
Rubric criteria — score each 0–5 by its key:
${criteriaText}

Hard-fail flags (set only with clear evidence; any one caps the result at REJECT):
${flagsText}

Score every criterion, list any flags, suggest a tier (A/B/C/REJECT) and give a one-line rationale.`;

  const tool: Anthropic.Tool = {
    name: "submit_scores",
    description:
      "Submit the 0–5 score for each rubric criterion, any hard-fail flags, a suggested tier, and a one-line rationale.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scores: {
          type: "object",
          description: "Map of rubric criterion key to an integer score from 0 to 5.",
          additionalProperties: false,
          properties: Object.fromEntries(
            criteria.map((c) => [
              c.key,
              { type: "integer", minimum: 0, maximum: 5, description: c.label },
            ])
          ),
          required: criteria.map((c) => c.key),
        },
        flags: {
          type: "array",
          description: "Hard-fail flag keys that clearly apply (usually empty).",
          items: { type: "string", enum: HARD_FAIL_FLAGS.map((f) => f.key) },
        },
        suggested_tier: { type: "string", enum: ["A", "B", "C", "REJECT"] },
        rationale: { type: "string", description: "One-line justification for the scores." },
      },
      required: ["scores", "flags", "suggested_tier", "rationale"],
    },
  };

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: "submit_scores" },
    messages: [{ role: "user", content: user }],
  });

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    return { available: false, reason: "the model did not return a scorecard — try again." };
  }
  const input = block.input as {
    scores?: Record<string, unknown>;
    flags?: unknown;
    suggested_tier?: unknown;
    rationale?: unknown;
  };

  // Coerce + clamp defensively — never trust raw model output for slider values.
  const scores: Record<string, number> = {};
  for (const c of criteria) {
    const raw = Number(input?.scores?.[c.key] ?? 0);
    scores[c.key] = Math.max(0, Math.min(5, Math.round(Number.isNaN(raw) ? 0 : raw)));
  }
  const validFlags = new Set<string>(HARD_FAIL_FLAGS.map((f) => f.key));
  const flags: string[] = Array.isArray(input?.flags)
    ? input.flags.filter((f): f is string => typeof f === "string" && validFlags.has(f))
    : [];
  const suggested_tier =
    typeof input?.suggested_tier === "string" ? input.suggested_tier : null;
  const rationale = typeof input?.rationale === "string" ? input.rationale : "";

  const draft: AiDraft = { scores, flags, suggested_tier, rationale };

  // Persist onto the scorecard's aiDraft column (create a draft card if needed).
  await prisma.scoreCard.upsert({
    where: { trialId },
    update: { aiDraft: JSON.stringify(draft) },
    create: {
      trialId,
      aiDraft: JSON.stringify(draft),
      scores: "{}",
      flags: "[]",
      weightedTotal: 0,
      finalized: false,
    },
  });

  return { available: true, draft };
}
