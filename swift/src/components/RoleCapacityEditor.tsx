"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type RoleCapacityRow = {
  key: string;
  displayName: string;
  capacity: number | null;
  load: number;
  remaining: number | null;
  open: boolean;
  recent: number;
};

// Inline editor for a role's target headcount. Blank = unlimited (never closes).
export default function RoleCapacityEditor({ rows }: { rows: RoleCapacityRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-panel2 text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Role</th>
            <th className="px-3 py-2 text-right font-medium">In funnel</th>
            <th className="px-3 py-2 text-right font-medium">Target</th>
            <th className="px-3 py-2 text-right font-medium">Remaining</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.key} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row }: { row: RoleCapacityRow }) {
  const router = useRouter();
  const [value, setValue] = useState(row.capacity == null ? "" : String(row.capacity));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = value !== (row.capacity == null ? "" : String(row.capacity));

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/roles/${row.key}/capacity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacity: value === "" ? null : Number(value) }),
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

  const remainingLabel = row.capacity == null ? "∞" : String(row.remaining ?? 0);

  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2 font-medium">
        {row.displayName}
        {row.recent > 0 && <span className="ml-2 text-[11px] text-muted">{row.recent} recent</span>}
      </td>
      <td className="px-3 py-2 text-right font-mono">{row.load}</td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <input
            className="input h-8 w-20 py-1 text-right"
            inputMode="numeric"
            placeholder="∞"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
          />
          <button
            className="btn-ghost btn-sm"
            disabled={busy || !dirty}
            onClick={save}
            title="Blank = unlimited"
          >
            {busy ? "…" : saved ? "✓" : "Save"}
          </button>
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono">{remainingLabel}</td>
      <td className="px-3 py-2">
        {row.open ? (
          <span className="pill bg-good/15 text-good border border-good/40">open</span>
        ) : (
          <span className="pill bg-bad/15 text-bad border border-bad/40">full — closed</span>
        )}
      </td>
    </tr>
  );
}
