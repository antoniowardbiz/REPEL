"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type FlagRow = {
  id: string;
  kind: string; // content_low | account_issue
  vaName: string;
  model: string | null;
  platform: string | null;
  note: string | null;
  createdAt: string | Date;
};

// "Needs attention" — content-out / account-down signals VAs raised with the
// bot. Front-and-centre on the dashboard so nothing slips; resolve when handled.
export default function OpsFlagsPanel({ flags }: { flags: FlagRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/flags/${id}/resolve`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (flags.length === 0) {
    return (
      <section className="card p-4">
        <h2 className="mb-1 font-display text-base font-semibold">Needs attention</h2>
        <p className="text-sm text-muted">All clear ✓ No content or account issues flagged.</p>
      </section>
    );
  }

  return (
    <section className="card border-warn/40 p-4">
      <h2 className="mb-3 font-display text-base font-semibold">
        Needs attention <span className="text-warn">({flags.length})</span>
      </h2>
      <div className="space-y-2">
        {flags.map((f) => {
          const account = f.kind === "account_issue";
          return (
            <div
              key={f.id}
              className={`flex items-start gap-3 rounded-lg border p-3 ${account ? "border-bad/40 bg-bad/5" : "border-warn/40 bg-warn/5"}`}
            >
              <span className="text-lg leading-none">{account ? "🚫" : "📉"}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {account ? "Account issue" : "Out of content"} — {f.vaName}
                  {(f.model || f.platform) && (
                    <span className="text-muted">
                      {" "}
                      · {f.model ?? "?"}
                      {f.platform ? `/${f.platform === "x" ? "X" : "Reddit"}` : ""}
                    </span>
                  )}
                </div>
                {f.note && <div className="mt-0.5 truncate text-xs text-muted">“{f.note}”</div>}
                <div className="mt-0.5 text-[11px] text-faint">
                  {account
                    ? "Check the account + hand a replacement from the pool."
                    : "Reload this model’s content drive."}
                </div>
              </div>
              <button
                className="btn-ghost btn-sm whitespace-nowrap"
                disabled={busy === f.id}
                onClick={() => resolve(f.id)}
              >
                {busy === f.id ? "…" : "Mark done"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
