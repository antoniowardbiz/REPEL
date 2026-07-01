import Link from "next/link";
import { prisma } from "@/lib/db";
import { Tier } from "@/lib/constants";
import { tierBadgeClass, timeAgo } from "@/lib/ui";
import { parseUrls } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export default async function ScorerQueue() {
  const trials = await prisma.trial.findMany({
    where: { status: "submitted" },
    include: { application: { include: { candidate: true, role: true } }, scoreCard: true },
    orderBy: { submittedAt: "asc" },
  });

  const awaiting = trials.filter((t) => !t.scoreCard?.finalized);
  const scored = trials.filter((t) => t.scoreCard?.finalized);

  const Row = ({ t }: { t: (typeof trials)[number] }) => {
    const urls = parseUrls(t.submissionUrls);
    const sc = t.scoreCard;
    return (
      <Link
        href={`/scoring/${t.id}`}
        className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2 p-3 hover:border-brand/60"
      >
        <div className="min-w-0">
          <div className="font-medium">{t.application.candidate.fullName}</div>
          <div className="text-xs text-muted">
            {t.application.role.displayName} · {urls.length} link{urls.length === 1 ? "" : "s"} · submitted{" "}
            {timeAgo(t.submittedAt)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sc?.tier ? (
            <span className={`pill ${tierBadgeClass(sc.tier as Tier)}`}>
              {sc.tier} · {sc.weightedTotal}
            </span>
          ) : (
            <span className="pill bg-warn/15 text-warn border border-warn/40">awaiting</span>
          )}
          <span className="text-muted">→</span>
        </div>
      </Link>
    );
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Scorer Queue</h1>
      <p className="mb-5 text-sm text-muted">
        Submitted trials. Score against the rubric — weighted total &amp; tier calculate live.
      </p>

      <section className="mb-6">
        <h2 className="label">Awaiting score ({awaiting.length})</h2>
        <div className="space-y-2">
          {awaiting.length === 0 && <p className="text-sm text-muted">Nothing waiting — nice. 🎉</p>}
          {awaiting.map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </div>
      </section>

      {scored.length > 0 && (
        <section>
          <h2 className="label">Recently scored ({scored.length})</h2>
          <div className="space-y-2 opacity-80">
            {scored.map((t) => (
              <Row key={t.id} t={t} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
