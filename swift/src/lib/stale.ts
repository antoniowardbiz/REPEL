// Stale-candidate sweep: nudge the operator about anyone stuck in a stage too
// long, and auto-archive role-less applicants that never progressed.

import { prisma } from "./db";
import { sendOpsAlert } from "./telegram";

// Days a candidate may sit in a stage before it's "stale".
const STALE_DAYS: Record<string, number> = {
  APPLIED: 7,
  ROLE_SELECTED: 5,
  TRAINING: 5,
  TRIAL_READY: 2,
  TRIAL_ACTIVE: 2,
  SUBMITTED: 3,
  SCORING: 3,
  DECISION: 5,
  ONBOARDING: 7,
};

export async function runStaleSweep() {
  const now = Date.now();

  const apps = await prisma.application.findMany({
    where: { stage: { notIn: ["ACTIVE", "ARCHIVED", "REJECTED"] }, candidate: { archived: false } },
    include: { candidate: true, role: true },
  });
  const stale = apps
    .filter((a) => now - a.stageChangedAt.getTime() >= (STALE_DAYS[a.stage] ?? 7) * 86_400_000)
    .map((a) => `• ${a.candidate.fullName} — ${a.role.displayName} stuck in ${a.stage}`);

  // Auto-archive role-less APPLIED candidates after 14 days.
  const loose = await prisma.candidate.findMany({
    where: { archived: false, applications: { none: {} }, currentStage: "APPLIED" },
  });
  let archived = 0;
  for (const c of loose) {
    if (now - c.createdAt.getTime() >= 14 * 86_400_000) {
      await prisma.candidate.update({ where: { id: c.id }, data: { archived: true } });
      archived++;
    }
  }

  if (stale.length || archived) {
    await sendOpsAlert(
      `🧹 Stale sweep: ${stale.length} stuck${archived ? `, ${archived} auto-archived` : ""}\n` +
        stale.slice(0, 15).join("\n")
    );
  }
  return { stale: stale.length, archived };
}
