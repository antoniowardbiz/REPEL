import { prisma } from "@/lib/db";
import { BOARD_STAGES, Stage, Tier } from "@/lib/constants";
import { timeAgo, deadlineLabel } from "@/lib/ui";
import Board, { BoardCard } from "@/components/Board";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [applications, looseCandidates, roles] = await Promise.all([
    prisma.application.findMany({
      where: { stage: { in: BOARD_STAGES as string[] } },
      include: {
        candidate: true,
        role: true,
        trials: { include: { scoreCard: true }, orderBy: { createdAt: "desc" } },
      },
      orderBy: { stageChangedAt: "asc" },
    }),
    // Candidates that have applied but not yet selected a role (no application).
    prisma.candidate.findMany({
      where: { archived: false, applications: { none: {} }, currentStage: { in: BOARD_STAGES as string[] } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.role.findMany({ where: { active: true }, orderBy: { displayName: "asc" } }),
  ]);

  const cards: BoardCard[] = [];

  for (const app of applications) {
    const latestTrial = app.trials[0];
    const sc = latestTrial?.scoreCard;
    const deadline =
      app.stage === "TRIAL_READY" || app.stage === "TRIAL_ACTIVE"
        ? deadlineLabel(latestTrial?.deadlineAt)
        : null;
    cards.push({
      applicationId: app.id,
      candidateId: app.candidateId,
      name: app.candidate.fullName,
      roleLabel: app.role.displayName,
      stage: app.stage as Stage,
      timeInStage: timeAgo(app.stageChangedAt),
      tier: (sc?.tier as Tier) ?? null,
      score: sc?.tier ? sc.weightedTotal : null,
      country: app.candidate.country,
      deadline,
      needsRole: false,
    });
  }

  for (const c of looseCandidates) {
    cards.push({
      applicationId: null,
      candidateId: c.id,
      name: c.fullName,
      roleLabel: null,
      stage: c.currentStage as Stage,
      timeInStage: timeAgo(c.createdAt),
      tier: null,
      score: null,
      country: c.country,
      deadline: null,
      needsRole: true,
    });
  }

  const roleOptions = roles.map((r) => ({ key: r.key, label: r.displayName }));

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Pipeline</h1>
          <p className="text-sm text-muted">
            Drag a card to move it — the destination stage fires its automation (send brief, queue scoring…).
          </p>
        </div>
      </div>
      <Board cards={cards} roleOptions={roleOptions} />
    </div>
  );
}
