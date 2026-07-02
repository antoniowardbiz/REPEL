"use client";

import { useState } from "react";
import type { PublicQuestion } from "@/lib/training";

type Result = {
  score: number;
  passed: boolean;
  passPct: number;
  correctCount: number;
  total: number;
  proceeded: boolean;
  weakAreas: string[];
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
        <div className="result pass">
          <div className="r-chev">»»»</div>
          <div className="r-status">You&apos;re Through</div>
          <div className="r-score">
            <b>
              {result!.correctCount} / {result!.total} correct
            </b>{" "}
            · {result!.score}%
          </div>
          <div className="r-msg">
            {result!.passed
              ? "Clean pass 🔥 You're unlocked — check your Telegram for the next step."
              : "You're unlocked ✅ — check your Telegram for the next step. Your manager will brush up a couple of areas with you (marked below)."}
          </div>
          {result!.weakAreas.length > 0 && (
            <div className="r-weak">
              <div className="r-weak-h">Worth reviewing:</div>
              <ul>
                {result!.weakAreas.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
