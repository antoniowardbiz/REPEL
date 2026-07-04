"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type EarnRow = {
  name: string;
  model: string;
  role: string;
  label: string | null;
  subs: number;
  earnings: number;
  commission: number;
  syncedAt: string | Date | null;
};

const money = (n: number) => `$${n.toFixed(2)}`;

// Earnings & commission: paste your Infloww export → each link label maps back
// to its VA → per-VA subs, earnings and commission owed, sorted top-first.
export default function EarningsPanel({
  rows,
  totals,
  pct,
}: {
  rows: EarnRow[];
  totals: { subs: number; earnings: number; commission: number };
  pct: number;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ updated: number; unmatched: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importEarn() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/earnings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult({ updated: j.updated ?? 0, unmatched: j.unmatched ?? [] });
        setText("");
        router.refresh();
      } else setError(j.error ?? "import failed");
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  const anyData = rows.some((r) => r.subs > 0 || r.earnings > 0);

  return (
    <section className="card mb-6 p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold">Earnings &amp; commission</h2>
        <span className="text-xs text-muted">
          commission = {pct}% of earnings · set <span className="font-mono">COMMISSION_PCT</span> to change
        </span>
      </div>
      <p className="mb-3 text-xs text-muted">
        Paste your Infloww <b>Free trial links</b> export (or the rows themselves). Each row’s label (e.g.{" "}
        <span className="font-mono">LAE-X-1</span>) maps back to its VA, so you get per-VA subs, earnings and what
        you owe.
      </p>

      <textarea
        className="input mb-2 min-h-[80px] w-full font-mono text-[12px]"
        placeholder={"LAE-X-1   14/∞   2.86%   $0.00   $188.00\nLOLA-R-3  9/∞    ...            $96.00\n(paste the whole Infloww export — it scans each row)"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn-primary btn-sm" disabled={busy || !text.trim()} onClick={importEarn}>
        {busy ? "Importing…" : "Import earnings"}
      </button>
      {result && (
        <div className="mt-2 text-xs">
          <span className="text-good">✓ Updated {result.updated} VA{result.updated === 1 ? "" : "s"}.</span>
          {result.unmatched.length > 0 && (
            <span className="ml-2 text-warn">
              {result.unmatched.length} label(s) matched no VA: {result.unmatched.slice(0, 8).join(", ")}
            </span>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-bad">⚠ {error}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">VA</th>
              <th className="px-3 py-2 text-left font-medium">Model</th>
              <th className="px-3 py-2 text-left font-medium">Link</th>
              <th className="px-3 py-2 text-right font-medium">Subs</th>
              <th className="px-3 py-2 text-right font-medium">Earnings</th>
              <th className="px-3 py-2 text-right font-medium">Commission</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name + i} className="border-t border-line">
                <td className="px-3 py-2 font-medium">
                  {i === 0 && anyData && r.earnings > 0 && <span className="mr-1">🏆</span>}
                  {r.name}
                </td>
                <td className="px-3 py-2 text-muted">{r.model}</td>
                <td className="px-3 py-2">
                  {r.label ? (
                    <span className="pill bg-panel2 font-mono text-[11px] text-muted">{r.label}</span>
                  ) : (
                    <span className="text-[11px] text-faint">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{r.subs}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{money(r.earnings)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-good">{money(r.commission)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-muted">
                  No VAs yet.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-line bg-panel2 font-semibold">
                <td className="px-3 py-2" colSpan={3}>
                  Total
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{totals.subs}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{money(totals.earnings)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-good">{money(totals.commission)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
