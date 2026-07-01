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
  answerKey: number[];
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

  const answeredCount = questions.filter((_, i) => answers[i] != null).length;
  const allAnswered = answeredCount === questions.length;
  const graded = result != null;

  async function submit() {
    if (!allAnswered || busy) return;
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
      if ((j as Result).passed && typeof document !== "undefined") {
        const chip = document.querySelector("#trial .chip");
        if (chip) {
          chip.classList.add("unlocked");
          const txt = chip.querySelector("span:last-child");
          if (txt) txt.textContent = "Trial · Unlocked";
        }
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function retake() {
    setResult(null);
    setAnswers({});
    setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function optClass(qi: number, oi: number): string {
    if (!graded) return answers[qi] === oi ? "opt sel" : "opt";
    if (oi === result!.answerKey[qi]) return "opt correct";
    if (oi === answers[qi]) return "opt wrong";
    return "opt";
  }

  return (
    <>
      <div className="gatehead">
        <h2>Trial Gate</h2>
        <div className="meter">
          <span>{answeredCount}</span> / <span>{questions.length}</span> answered · <b>Pass {passPct}%</b>
        </div>
      </div>
      <div className="gatesub">Answer all questions. Score {passPct}% or higher to unlock your trial.</div>

      <div>
        {questions.map((q, qi) => (
          <div className="q" key={qi}>
            <div className="q-h">
              <span className="q-n">Q{qi + 1}</span>
              <span className="q-t">{q.prompt}</span>
            </div>
            <div className={`opts ${graded ? "graded" : ""}`}>
              {q.options.map((opt, oi) => (
                <button
                  key={oi}
                  type="button"
                  className={optClass(qi, oi)}
                  onClick={() => {
                    if (graded) return;
                    setAnswers((a) => ({ ...a, [qi]: oi }));
                  }}
                >
                  <span className="box" />
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="gatesub" style={{ color: "var(--red)", marginTop: 12 }}>
          ⚠ {error}
        </div>
      )}

      {!graded && (
        <button className="submit" disabled={busy || !allAnswered} onClick={submit}>
          {busy ? "Submitting…" : "Submit & unlock"}
        </button>
      )}

      {graded && (
        <div className={`result ${result!.passed ? "pass" : ""}`}>
          <div className="r-chev">»»»</div>
          <div className="r-status">{result!.passed ? "Trial Unlocked" : "Not Yet"}</div>
          <div className="r-score">
            <b>
              {result!.correctCount} / {result!.total} correct
            </b>{" "}
            · {result!.score}% · pass mark {result!.passPct}%
          </div>
          <div className="r-msg">
            {result!.passed
              ? "Clean pass. Your trial is unlocked — check your Telegram for the brief and your task."
              : "Review the playbook above and retake. The bar is high because a single account mistake ends a trial."}
          </div>
          {!result!.passed && (
            <div>
              <button className="r-cta" onClick={retake}>
                Review &amp; retake
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
