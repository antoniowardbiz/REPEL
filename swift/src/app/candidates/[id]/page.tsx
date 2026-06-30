import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Stage, Tier } from "@/lib/constants";
import { stageBadgeClass, tierBadgeClass, timeAgo, deadlineLabel } from "@/lib/ui";
import { parseUrls } from "@/lib/serialize";
import CandidateActions from "@/components/CandidateActions";

export const dynamic = "force-dynamic";

export default async function CandidateDetail({ params }: { params: { id: string } }) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: params.id },
    include: {
      currentRole: true,
      applications: {
        include: { role: true, trials: { include: { scoreCard: true }, orderBy: { createdAt: "desc" } } },
        orderBy: { appliedAt: "desc" },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!candidate) notFound();

  const roles = await prisma.role.findMany({ where: { active: true }, orderBy: { displayName: "asc" } });
  const roleOptions = roles.map((r) => ({ key: r.key, label: r.displayName }));

  const primary = candidate.applications[0] ?? null;
  const primaryTrial = primary?.trials[0] ?? null;

  return (
    <div>
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted hover:text-white">
          ← Pipeline
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{candidate.fullName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {candidate.telegramHandle && <span>{candidate.telegramHandle}</span>}
            {candidate.country && <span>· {candidate.country}</span>}
            <span>· source: {candidate.source}</span>
            <span>· added {timeAgo(candidate.createdAt)}</span>
          </div>
        </div>
        <span className={`badge ${stageBadgeClass(candidate.currentStage as Stage)}`}>
          {candidate.currentStage}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left: details + applications */}
        <div className="space-y-5 lg:col-span-2">
          {candidate.whyText && (
            <section className="card p-4">
              <h2 className="label">Why this role</h2>
              <p className="text-sm text-gray-200">{candidate.whyText}</p>
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-3 font-display text-base font-semibold">
              Applications &amp; trials ({candidate.applications.length})
            </h2>
            {candidate.applications.length === 0 && (
              <p className="text-sm text-muted">
                No application yet — select a role on the right to start the pipeline.
              </p>
            )}
            <div className="space-y-3">
              {candidate.applications.map((app) => {
                const trial = app.trials[0];
                const sc = trial?.scoreCard;
                const urls = parseUrls(trial?.submissionUrls);
                const dl = trial ? deadlineLabel(trial.deadlineAt) : null;
                return (
                  <div key={app.id} className="card-2 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{app.role.displayName}</div>
                      <span className={`badge ${stageBadgeClass(app.stage as Stage)}`}>{app.stage}</span>
                    </div>
                    {trial && (
                      <div className="mt-2 space-y-1 text-sm text-gray-300">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                          {trial.accountUsed && <span>account: {trial.accountUsed}</span>}
                          <span>status: {trial.status}</span>
                          {trial.deadlineAt && trial.status !== "submitted" && (
                            <span className={dl?.tone === "bad" ? "text-bad" : dl?.tone === "warn" ? "text-warn" : "text-good"}>
                              {dl?.text}
                            </span>
                          )}
                          {trial.submittedAt && <span>submitted {timeAgo(trial.submittedAt)}</span>}
                        </div>
                        {urls.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {urls.map((u, i) => (
                              <li key={i}>
                                <a href={u} target="_blank" className="text-brand2 hover:underline break-all">
                                  {u}
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {trial.status === "submitted" && (
                          <div className="mt-2 flex items-center gap-2">
                            {sc?.tier ? (
                              <span className={`pill ${tierBadgeClass(sc.tier as Tier)}`}>
                                {sc.tier} · {sc.weightedTotal}
                                {sc.finalized ? "" : " (draft)"}
                              </span>
                            ) : (
                              <span className="pill bg-warn/15 text-warn border border-warn/40">needs scoring</span>
                            )}
                            <Link href={`/scoring/${trial.id}`} className="btn-ghost btn-sm">
                              {sc?.finalized ? "Review score" : "Score trial →"}
                            </Link>
                          </div>
                        )}
                        {sc?.rationale && <p className="mt-1 text-xs text-muted">“{sc.rationale}”</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Message history */}
          <section className="card p-4">
            <h2 className="mb-3 font-display text-base font-semibold">Messages ({candidate.messages.length})</h2>
            {candidate.messages.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
            <div className="space-y-2">
              {candidate.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg border p-2.5 text-sm ${
                    m.status === "failed"
                      ? "border-bad/50 bg-bad/5"
                      : m.direction === "outbound"
                      ? "border-line bg-panel2"
                      : "border-brand/30 bg-brand/5"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
                    <span className="uppercase">{m.direction}</span>
                    {m.templateKey && <span>· {m.templateKey}</span>}
                    <span>· {m.status}</span>
                    <span>· {timeAgo(m.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-gray-200">{m.body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right: actions */}
        <div className="space-y-5">
          <CandidateActions
            candidateId={candidate.id}
            archived={candidate.archived}
            primaryApplicationId={primary?.id ?? null}
            primaryStage={(primary?.stage as Stage) ?? null}
            primaryTrialStatus={primaryTrial?.status ?? null}
            roleOptions={roleOptions}
          />
        </div>
      </div>
    </div>
  );
}
