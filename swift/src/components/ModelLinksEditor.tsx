"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ModelRow = {
  id: string;
  name: string;
  contentDriveUrl: string;
  xMainUrl: string;
};

// Live editor for each model's links. These flow straight into trial briefs,
// the onboarding welcome, and the AI support agent — no deploy needed.
export default function ModelLinksEditor({ models }: { models: ModelRow[] }) {
  return (
    <div className="space-y-3">
      {models.map((m) => (
        <Row key={m.id} model={m} />
      ))}
      {models.length === 0 && <p className="text-sm text-muted">No active models.</p>}
    </div>
  );
}

function Row({ model }: { model: ModelRow }) {
  const router = useRouter();
  const [drive, setDrive] = useState(model.contentDriveUrl);
  const [main, setMain] = useState(model.xMainUrl);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = drive !== model.contentDriveUrl || main !== model.xMainUrl;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/creators/${model.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentDriveUrl: drive, xMainUrl: main }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1800);
      } else setError(j.error ?? "save failed");
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-base tracking-wide">{model.name}</span>
        <button className="btn-ghost btn-sm" disabled={busy || !dirty} onClick={save}>
          {busy ? "…" : saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="label">Content drive (what VAs post from)</label>
          <input
            className="input"
            placeholder="https://drive.google.com/…"
            value={drive}
            onChange={(e) => setDrive(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Main page URL</label>
          <input
            className="input"
            placeholder="https://x.com/…"
            value={main}
            onChange={(e) => setMain(e.target.value)}
          />
        </div>
      </div>
      {!drive && (
        <p className="mt-2 text-xs text-warn">
          ⚠ No content drive set — trial briefs for this model can&apos;t tell VAs what to post.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-bad">⚠ {error}</p>}
    </div>
  );
}
