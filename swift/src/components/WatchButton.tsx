"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WatchButton({ trialId }: { trialId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/trials/${trialId}/watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(j.result ? `✓ rated ${j.result.rating}/10 (${j.result.source})` : "✓ watch started");
        router.refresh();
      } else {
        setMsg(`⚠ ${j.error ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn-ghost btn-sm w-full" disabled={busy} onClick={run}>
        {busy ? "Checking…" : "Run watcher now"}
      </button>
      {msg && <p className="mt-1 text-center text-[11px] text-muted">{msg}</p>}
    </div>
  );
}
