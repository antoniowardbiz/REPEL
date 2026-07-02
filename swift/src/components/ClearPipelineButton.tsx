"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Small, deliberately-understated control to wipe test applicants from the
// board (APPLIED → DECISION). Requires typing the exact phrase, so it can't be
// fat-fingered. Hired VAs and archived/rejected records are never touched.
export default function ClearPipelineButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function clear() {
    const phrase = window.prompt(
      "This permanently DELETES every candidate in APPLIED → DECISION (your test applicants).\n" +
        "Hired VAs are NOT touched.\n\n" +
        'Type  DELETE TEST DATA  to confirm:'
    );
    if (phrase !== "DELETE TEST DATA") return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/clear-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE TEST DATA" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) {
        alert(`Failed: ${j.error ?? res.status}`);
      } else {
        alert(`Cleared ${j.deleted} candidate${j.deleted === 1 ? "" : "s"} from the pipeline.`);
        router.refresh();
      }
    } catch {
      alert("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={clear}
      disabled={busy}
      className="text-xs text-muted underline-offset-2 hover:text-bad hover:underline disabled:opacity-50"
      title="Delete all test applicants (APPLIED → DECISION). Hired VAs are kept."
    >
      {busy ? "Clearing…" : "Clear test data"}
    </button>
  );
}
