"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Inline editor for a VA's personalised OF tracking link (pulled from Infloww).
// Paste it here at hire so subs are attributed to this VA. Saves live — no deploy.
export default function AssignmentPromoLink({ id, promoLink }: { id: string; promoLink: string }) {
  const router = useRouter();
  const [value, setValue] = useState(promoLink);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = value.trim() !== promoLink.trim();

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/assignments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoLink: value.trim() === "" ? null : value.trim() }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        className="input h-7 w-full py-0.5 font-mono text-[11px]"
        placeholder="paste Infloww OF link…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty && !busy) save();
        }}
      />
      <button className="btn-ghost btn-sm shrink-0" disabled={busy || !dirty} onClick={save}>
        {busy ? "…" : saved ? "✓" : "Save"}
      </button>
    </div>
  );
}
