"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// One-click: generate a personal promo link for every VA that doesn't have one
// yet (VAs hired before the feature existed). New hires get theirs automatically.
export default function PromoBackfillButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/assignments/promo-backfill", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(j.generated > 0 ? `✓ generated ${j.generated}` : "✓ all set — everyone already has one");
        router.refresh();
      } else setMsg(`⚠ ${j.error ?? "failed"}`);
    } catch {
      setMsg("⚠ network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost btn-sm" disabled={busy} onClick={run}>
        {busy ? "…" : "Generate missing links"}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
