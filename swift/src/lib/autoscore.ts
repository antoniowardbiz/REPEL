// Take manual scoring off your plate. Under mass-hire everyone is hired the
// moment they submit, so the scorer queue is pure busywork — it just piles up
// demanding clicks that never change the outcome. This auto-finalizes those
// submitted trials (so the queue clears itself) and sends YOU a private digest
// with each new hire's submission links to eyeball if you want. The VA never
// sees a score, so nobody is demotivated or inflated. Scores never gate anyone.

import { prisma } from "./db";
import { sendOpsAlert } from "./telegram";

/**
 * Auto-clear the scorer queue. Returns how many trials were cleared. Safe to run
 * often — idempotent (only touches un-finalized scorecards on submitted trials).
 */
export async function autoClearScoring(): Promise<{ cleared: number }> {
  const pending = await prisma.trial.findMany({
    where: { status: "submitted" },
    include: {
      application: { include: { candidate: true, role: true } },
      scoreCard: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  const toClear = pending.filter((t) => !t.scoreCard || !t.scoreCard.finalized);
  if (toClear.length === 0) return { cleared: 0 };

  const lines: string[] = [];
  for (const t of toClear) {
    let urls: string[] = [];
    try {
      urls = t.submissionUrls ? JSON.parse(t.submissionUrls) : [];
    } catch {
      urls = [];
    }
    // Finalize as AUTO so it leaves the "unscored" queue. No per-criterion scores
    // are invented; the rationale makes clear this wasn't a manual judgement.
    await prisma.scoreCard.upsert({
      where: { trialId: t.id },
      update: {
        finalized: true,
        tier: "AUTO",
        scoredAt: new Date(),
        rationale: "Auto-cleared under mass-hire — not a manual score, not a gate. Review the VA's work in Telegram.",
      },
      create: {
        trialId: t.id,
        scores: "{}",
        flags: "[]",
        weightedTotal: 0,
        finalized: true,
        tier: "AUTO",
        scoredAt: new Date(),
        rationale: "Auto-cleared under mass-hire — not a manual score, not a gate. Review the VA's work in Telegram.",
      },
    });
    const link = urls[0] ? ` — ${urls[0]}` : "";
    lines.push(`• ${t.application.candidate.fullName} (${t.application.role.displayName})${link}`);
  }

  // One private digest to you — eyeball the work if you want; no action needed.
  const shown = lines.slice(0, 20);
  const more = lines.length - shown.length;
  await sendOpsAlert(
    `🗂️ Scoring auto-cleared — ${toClear.length} new hire${toClear.length === 1 ? "" : "s"} to eyeball ` +
      `(no scoring needed; they're already onboarding):\n` +
      shown.join("\n") +
      (more > 0 ? `\n…and ${more} more` : "")
  );
  return { cleared: toClear.length };
}
