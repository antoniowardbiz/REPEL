"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// DMs every VA their personal promo link (assigns any missing ones first).
// Use it after importing the trial-link pool so everyone actually gets theirs.
export default function SendLinksButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    if (!confirm("DM every active VA their personal promo link now?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/assignments/send-links", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`⚠ ${j.error ?? "failed"}`);
      } else {
        const extra = [
          j.noChat ? `${j.noChat} never messaged the bot` : "",
          j.noLink ? `${j.noLink} still have no link` : "",
        ]
          .filter(Boolean)
          .join(", ");
        setMsg(`✓ Sent ${j.sent} link${j.sent === 1 ? "" : "s"}${extra ? ` · ${extra}` : ""}`);
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
      <button className="btn-ghost btn-sm" disabled={busy} onClick={send}>
        {busy ? "Sending…" : "Send everyone their link"}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
