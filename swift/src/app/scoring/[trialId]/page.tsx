import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseCriteria, parseScores, parseFlags, parseUrls } from "@/lib/serialize";
import { timeAgo } from "@/lib/ui";
import Scorer from "@/components/Scorer";
import WatchButton from "@/components/WatchButton";

export const dynamic = "force-dynamic";

export default async function ScoringDetail({ params }: { params: { trialId: string } }) {
  const trial = await prisma.trial.findUnique({
    where: { id: params.trialId },
    include: {
      application: { include: { candidate: true, role: { include: { rubric: true } } } },
      scoreCard: true,
      creator: true,
      watch: { include: { observations: { orderBy: { capturedAt: "desc" }, take: 5 } } },
    },
  });
  if (!trial) notFound();

  const autoRating = trial.scoreCard?.autoRating ?? null;
  const observations = trial.watch?.observations ?? [];

  const criteria = parseCriteria(trial.application.role.rubric?.criteria);
  const urls = parseUrls(trial.submissionUrls);
  const existingScores = parseScores(trial.scoreCard?.scores);
  const existingFlags = parseFlags(trial.scoreCard?.flags);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/scoring" className="text-sm text-muted hover:text-white">
          ← Scorer Queue
        </Link>
        <Link href={`/candidates/${trial.application.candidateId}`} className="text-sm text-muted hover:text-white">
          Candidate detail →
        </Link>
      </div>

      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">{trial.application.candidate.fullName}</h1>
        <p className="text-sm text-muted">
          {trial.application.role.displayName}
          {trial.creator ? ` · model: ${trial.creator.name}` : ""}
          {trial.accountUsed ? ` · account: ${trial.accountUsed}` : ""}
          {trial.submittedAt ? ` · submitted ${timeAgo(trial.submittedAt)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Submission */}
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="label">Submission</h2>
            {urls.length === 0 && <p className="text-sm text-muted">No links recorded.</p>}
            <ul className="space-y-1.5">
              {urls.map((u, i) => (
                <li key={i}>
                  <a href={u} target="_blank" className="text-sm text-brand2 hover:underline break-all">
                    {u}
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="label mb-0">Trial watcher</h2>
              {autoRating != null && (
                <span className="pill bg-brand/15 text-brand2 border border-brand/40">auto {autoRating}/10</span>
              )}
            </div>
            {trial.watch ? (
              <div className="text-xs text-muted">
                <div>
                  platform: {trial.watch.platform} · source: {trial.watch.source}
                </div>
                <div>last checked: {trial.watch.lastCheckedAt ? timeAgo(trial.watch.lastCheckedAt) : "never"}</div>
              </div>
            ) : (
              <p className="text-xs text-muted">No watch yet — run one to auto-rate this trial.</p>
            )}
            {observations.length > 0 && (
              <ul className="mt-2 space-y-1 text-[11px] text-muted">
                {observations.map((o) => (
                  <li key={o.id}>
                    • {timeAgo(o.capturedAt)}: {o.notes}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <WatchButton trialId={trial.id} />
            </div>
          </section>

          {trial.application.whyText && (
            <section className="card p-4">
              <h2 className="label">Their “why”</h2>
              <p className="text-sm text-gray-200">{trial.application.whyText}</p>
            </section>
          )}
        </div>

        {/* Scorer */}
        <div className="lg:col-span-2">
          <Scorer
            trialId={trial.id}
            criteria={criteria}
            initialScores={existingScores}
            initialFlags={existingFlags}
            initialRationale={trial.scoreCard?.rationale ?? ""}
            finalized={trial.scoreCard?.finalized ?? false}
            autoRating={autoRating}
          />
        </div>
      </div>
    </div>
  );
}
