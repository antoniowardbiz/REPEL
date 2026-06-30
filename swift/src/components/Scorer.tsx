"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HARD_FAIL_FLAGS, RubricCriterion, TIER_THRESHOLDS } from "@/lib/constants";
import { computeWeightedTotal, tierFor } from "@/lib/scoring";
import { tierBadgeClass } from "@/lib/ui";

export default function Scorer({
  trialId,
  criteria,
  initialScores,
  initialFlags,
  initialRationale,
  finalized,
  autoRating,
}: {
  trialId: string;
  criteria: RubricCriterion[];
  initialScores: Record<string, number>;
  initialFlags: string[];
  initialRationale: string;
  finalized: boolean;
  autoRating?: number | null;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>(initialScores);
  const [flags, setFlags] = useState<string[]>(initialFlags);
  const [rationale, setRationale] = useState(initialRationale);
  const [autoSend, setAutoSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const total = useMemo(() => computeWeightedTotal(scores, criteria), [scores, criteria]);
  const tier = useMemo(() => tierFor(total, flags), [total, flags]);
  const tierNote = TIER_THRESHOLDS.find((t) => t.tier === tier)!;

  function setScore(key: string, v: number) {
    setScores((s) => ({ ...s, [key]: v }));
  }
  function toggleFlag(key: string) {
    setFlags((f) => (f.includes(key) ? f.filter((x) => x !== key) : [...f, key]));
  }

  async function saveDraft() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/scorecards/${trialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores, flags, rationale }),
      });
      setMsg(res.ok ? "✓ draft saved" : "⚠ save failed");
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!confirm(`Finalize as tier ${tier} (${total}/100)?${autoSend ? " The outcome message will be sent." : ""}`))
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/scorecards/${trialId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores, flags, rationale, autoSendOutcome: autoSend }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push("/scoring");
        router.refresh();
      } else {
        setMsg(`⚠ ${j.error ?? "finalize failed"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const weightSum = criteria.reduce((a, c) => a + c.weight, 0);

  return (
    <div className="card p-4">
      {/* Live total */}
      <div className="mb-4 flex items-center justify-between rounded-lg border border-line bg-panel2 p-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Weighted total</div>
          <div className="font-display text-3xl font-bold">
            {total}
            <span className="text-base font-normal text-muted">/100</span>
          </div>
        </div>
        <div className="text-right">
          <span className={`pill ${tierBadgeClass(tier)} text-sm`}>{tierNote.label}</span>
          <div className="mt-1 max-w-[220px] text-[11px] text-muted">{tierNote.note}</div>
        </div>
      </div>

      {autoRating != null && (
        <div className="mb-4 rounded-lg border border-brand/30 bg-brand/5 p-2 text-center text-xs text-brand2">
          🤖 Watcher auto-rating: <b>{autoRating}/10</b> — sliders are pre-filled from it. Review &amp; adjust, then finalize.
        </div>
      )}

      {finalized && (
        <div className="mb-4 rounded-lg border border-good/30 bg-good/5 p-2 text-center text-xs text-good">
          This scorecard is finalized. Editing &amp; re-finalizing will overwrite it.
        </div>
      )}

      {/* Criteria sliders */}
      <div className="space-y-4">
        {criteria.map((c) => {
          const v = Number(scores[c.key] ?? 0);
          const contribution = Math.round((v / 5) * c.weight * 10) / 10;
          return (
            <div key={c.key} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  {c.label} <span className="text-xs text-muted">· weight {c.weight}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-lg font-bold">{v}</span>
                  <span className="text-xs text-muted">/5 → {contribution}</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={v}
                onChange={(e) => setScore(c.key, Number(e.target.value))}
                className="mt-2 w-full accent-brand"
              />
              <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-muted">
                <span>1 · {c.anchor_1}</span>
                <span className="text-center">3 · {c.anchor_3}</span>
                <span className="text-right">5 · {c.anchor_5}</span>
              </div>
            </div>
          );
        })}
      </div>
      {Math.abs(weightSum - 100) > 0.01 && (
        <p className="mt-2 text-xs text-warn">⚠ Rubric weights sum to {weightSum}, not 100.</p>
      )}

      {/* Hard-fail flags */}
      <div className="mt-4 rounded-lg border border-bad/30 bg-bad/5 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-bad">
          Hard-fail flags (any one caps the tier at REJECT)
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {HARD_FAIL_FLAGS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={flags.includes(f.key)}
                onChange={() => toggleFlag(f.key)}
                className="accent-bad"
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      {/* Rationale */}
      <div className="mt-4">
        <label className="label">One-line rationale</label>
        <textarea
          className="input min-h-[60px]"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Why this tier — one line."
        />
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} className="accent-brand" />
          Auto-send outcome message on finalize
        </label>
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" disabled={busy} onClick={saveDraft}>
            Save draft
          </button>
          <button className="btn-primary btn-sm" disabled={busy} onClick={finalize}>
            Finalize → DECISION
          </button>
        </div>
      </div>
      {msg && <p className="mt-2 text-right text-xs text-muted">{msg}</p>}
    </div>
  );
}
