import { notFound } from "next/navigation";
import { getTrainingByToken } from "@/lib/training";
import Quiz from "@/components/Quiz";

export const dynamic = "force-dynamic";

export default async function TrainingPage({ params }: { params: { token: string } }) {
  const view = await getTrainingByToken(params.token);
  if (!view) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">
          {view.module?.title ?? "Training"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {view.candidateName}
          {view.roleName ? ` · ${view.roleName}` : ""}
        </p>
      </div>

      {view.status === "no_role" && (
        <div className="card p-6 text-sm text-muted">
          You don&apos;t have a role selected yet, so there&apos;s no training assigned. We&apos;ll
          message you on Telegram once your role is set.
        </div>
      )}

      {view.status === "no_module" && (
        <div className="card p-6 text-sm text-muted">
          There&apos;s no training module for your role yet. Watch your Telegram for next steps.
        </div>
      )}

      {view.status === "unlocked" && (
        <div className="card p-6 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="mt-2 font-display text-lg font-semibold text-good">
            Training complete — your trial is unlocked.
          </h2>
          <p className="mt-1 text-sm text-muted">
            {view.lastAttempt
              ? `You scored ${view.lastAttempt.score}%. `
              : ""}
            Check your Telegram for the brief and your task.
          </p>
        </div>
      )}

      {view.status === "ready" && view.module && (
        <div className="space-y-5">
          <section className="card p-5">
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
              {view.module.content}
            </div>
          </section>
          {view.lastAttempt && !view.lastAttempt.passed && (
            <p className="text-center text-xs text-warn">
              Last attempt: {view.lastAttempt.score}% — you need {view.module.passPct}%. Give it
              another go below.
            </p>
          )}
          <Quiz token={params.token} passPct={view.module.passPct} questions={view.module.questions} />
        </div>
      )}
    </div>
  );
}
