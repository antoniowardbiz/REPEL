import { ok, fail, readJSON } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/services";

// POST /api/admin/clear-pipeline — permanently delete every candidate currently
// sitting in a PRE-HIRE stage (APPLIED → DECISION), so the operator can wipe
// test applicants and start clean before real VAs come through. Requires an
// explicit typed confirmation. NEVER touches:
//   • hired VAs (ONBOARDING / ACTIVE, or anyone with a User row), or
//   • terminal records (ARCHIVED / REJECTED).
// Deleting a candidate cascades their Application → Trial → ScoreCard, Messages
// and QuizAttempts; ActivityEvents have no cascade so they're cleared first.

const PRE_HIRE = [
  "APPLIED",
  "ROLE_SELECTED",
  "TRAINING",
  "TRIAL_READY",
  "TRIAL_ACTIVE",
  "SUBMITTED",
  "SCORING",
  "DECISION",
];

const CONFIRM = "DELETE TEST DATA";

export async function POST(req: Request) {
  const body = await readJSON(req);
  if (body.confirm !== CONFIRM) {
    return fail(`type "${CONFIRM}" to confirm`);
  }
  try {
    // Pre-hire stage AND not hired (hiredUser guard is a belt-and-braces safety
    // net so a hired VA whose currentStage somehow lags can never be deleted).
    const candidates = await prisma.candidate.findMany({
      where: { currentStage: { in: PRE_HIRE }, hiredUser: null },
      select: { id: true },
    });
    const ids = candidates.map((c) => c.id);
    if (ids.length === 0) return ok({ ok: true, deleted: 0 });

    await prisma.activityEvent.deleteMany({ where: { candidateId: { in: ids } } });
    const res = await prisma.candidate.deleteMany({ where: { id: { in: ids } } });
    await auditLog("pipeline_cleared", "Candidate", "bulk", { deleted: res.count });
    return ok({ ok: true, deleted: res.count });
  } catch (e: any) {
    return fail(e?.message ?? "clear failed", 500);
  }
}
