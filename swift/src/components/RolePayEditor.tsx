"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type RolePayRow = {
  key: string;
  displayName: string;
  pay: string; // the effective pay line (DB value, or code default when unset)
  custom: boolean; // true when a live edit is stored in the DB (vs the code default)
};

// Inline editor for the pay line each role's VAs see (welcome message + AI
// support answers). Saves live — no deploy. Blank = fall back to the built-in
// default.
export default function RolePayEditor({ rows }: { rows: RolePayRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Row key={r.key} row={r} />
      ))}
      {rows.length === 0 && <p className="text-sm text-muted">No active roles.</p>}
    </div>
  );
}

function Row({ row }: { row: RolePayRow }) {
  const router = useRouter();
  const [value, setValue] = useState(row.pay);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = value.trim() !== row.pay.trim();

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/roles/${row.key}/pay`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pay: value.trim() === "" ? null : value.trim() }),
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
    <div className="rounded-lg border border-line bg-panel2 p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-semibold">{row.displayName}</span>
        {row.custom && <span className="pill bg-brand/15 text-brand text-[10px]">custom</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          className="input h-8 flex-1 py-1"
          placeholder="Pay line VAs see (blank = default)"
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
    </div>
  );
}
