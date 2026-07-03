"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PoolBucket = { creatorName: string; platform: string; available: number; assigned: number };

// Trial-link pool: paste your Infloww links (each line = a label like LOLA-R-3
// plus its URL) and the bot auto-assigns one to each VA at hire, matching their
// model + platform. Shows how many are left per bucket so you know when to top up.
export default function TrialLinkPool({ buckets }: { buckets: PoolBucket[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importLinks() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/trial-links/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult({ imported: j.imported ?? 0, skipped: j.skipped ?? [] });
        setText("");
        router.refresh();
      } else setError(j.error ?? "import failed");
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  const LOW = 3;

  return (
    <section className="card p-4">
      <h2 className="mb-1 font-display text-base font-semibold">Trial-link pool</h2>
      <p className="mb-3 text-xs text-muted">
        Paste your Infloww links (one per line, each with its label like{" "}
        <span className="font-mono">LOLA-R-3</span> and its URL). The bot hands one to each new VA automatically —
        matched to their model + platform.
      </p>

      {buckets.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {buckets.map((b) => {
            const low = b.available <= LOW;
            return (
              <div
                key={`${b.creatorName}-${b.platform}`}
                className={`rounded-lg border p-2.5 ${low ? "border-warn/50 bg-warn/5" : "border-line bg-panel2"}`}
              >
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {b.creatorName} · {b.platform === "x" ? "X" : "Reddit"}
                </div>
                <div className="mt-1 font-mono text-lg tabular-nums">
                  <span className={low ? "text-warn" : "text-good"}>{b.available}</span>
                  <span className="text-faint text-sm"> left</span>
                </div>
                <div className="text-[11px] text-faint">{b.assigned} assigned{low ? " · top up soon" : ""}</div>
              </div>
            );
          })}
        </div>
      )}

      <textarea
        className="input mb-2 min-h-[110px] w-full font-mono text-[12px]"
        placeholder={"LOLA-R-1  https://onlyfans.com/action/trial/…\nLOLA-R-2  https://onlyfans.com/action/trial/…\n(paste all of them — CSV from Infloww's Export works too)"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn-primary btn-sm" disabled={busy || !text.trim()} onClick={importLinks}>
        {busy ? "Importing…" : "Import links"}
      </button>

      {result && (
        <div className="mt-3 text-xs">
          <p className="text-good">✓ Imported {result.imported} link{result.imported === 1 ? "" : "s"}.</p>
          {result.skipped.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted">{result.skipped.length} skipped</summary>
              <ul className="mt-1 list-disc pl-5 text-faint">
                {result.skipped.slice(0, 20).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-bad">⚠ {error}</p>}
    </section>
  );
}
