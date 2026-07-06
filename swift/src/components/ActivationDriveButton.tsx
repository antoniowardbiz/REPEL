"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Nudges every stalled pre-active VA (role-selected / training / trial-ready)
// to START, with an incentive + their next step re-sent. Capped + spaced, so
// clicking it repeatedly is safe — it won't re-message anyone too soon.
export default function ActivationDriveButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!confirm("Nudge every stalled VA who hasn't started yet to get going now?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/assignments/activation-drive", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`⚠ ${j.error ?? "failed"}`);
      } else {
        setMsg(`✓ Nudged ${j.nudged} · ${j.skipped} skipped · ${j.done} maxed out`);
        router.refresh();
      }
    } catch {
      setMsg("⚠ network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost btn-sm" disabled={busy} onClick={run}>
        {busy ? "Nudging…" : "Kick-start stalled VAs"}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
