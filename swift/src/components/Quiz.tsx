"use client";

import { useState } from "react";
import type { PublicQuestion } from "@/lib/training";

type Result = {
  score: number;
  passed: boolean;
  passPct: number;
  correctCount: number;
  total: number;
  unlocked: boolean;
};

export default function Quiz({
  token,
  passPct,
  questions,
}: {
  token: string;
  passPct: number;
  questions: PublicQuestion[];
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const allAnswered = questions.every((_, i) => answers[i] != null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = questions.map((_, i) => answers[i] ?? -1);
      const res = await fetch(`/api/training/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) {
        setError(j.reason ?? j.error ?? "Something went wrong");
        return;
      }
      setResult(j as Result);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    if (result.passed) {
      return (
        <div className="card p-6 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="mt-2 font-display text-xl font-bold text-good">
            Passed — {result.score}%
          </h2>
          <p className="mt-1 text-sm text-muted">
            You got {result.correctCount}/{result.total} correct.
            {result.unlocked
              ? " Your trial is now unlocked — check your Telegram for the brief and your task."
              : " Your training is complete."}
          </p>
        </div>
      );
    }
    return (
      <div className="card p-6 text-center">
        <div className="text-4xl">📚</div>
        <h2 className="mt-2 font-display text-xl font-bold text-warn">
          {result.score}% — not quite ({result.passPct}% needed)
        </h2>
        <p className="mt-1 text-sm text-muted">
          You got {result.correctCount}/{result.total} correct. Re-read the material above and try
          again.
        </p>
        <button
          className="btn-ghost mt-4"
          onClick={() => {
            setResult(null);
            setAnswers({});
          }}
        >
          Retake the quiz
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h2 className="mb-1 font-display text-lg font-semibold">Quiz</h2>
      <p className="mb-4 text-sm text-muted">
        Answer all {questions.length} questions. You need {passPct}% to unlock your trial.
      </p>
      <div className="space-y-5">
        {questions.map((q, qi) => (
          <div key={qi} className="rounded-lg border border-line p-3">
            <div className="mb-2 text-sm font-medium">
              {qi + 1}. {q.prompt}
            </div>
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => (
                <label
                  key={oi}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${
                    answers[qi] === oi
                      ? "border-brand/60 bg-brand/10"
                      : "border-line bg-panel2 hover:border-brand/40"
                  }`}
                >
                  <input
                    type="radio"
                    name={`q${qi}`}
                    className="accent-brand"
                    checked={answers[qi] === oi}
                    onChange={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-bad">⚠ {error}</p>}
      <button className="btn-primary mt-4 w-full" disabled={busy || !allAnswered} onClick={submit}>
        {busy ? "Submitting…" : allAnswered ? "Submit quiz" : "Answer all questions to submit"}
      </button>
    </div>
  );
}
