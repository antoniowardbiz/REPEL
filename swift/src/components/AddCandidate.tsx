"use client";

import { useState } from "react";

export default function AddCandidate({
  roleOptions,
  onDone,
}: {
  roleOptions: { key: string; label: string }[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    telegramHandle: "",
    country: "",
    roleKey: "",
    whyText: "",
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.fullName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, roleKey: form.roleKey || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Failed: ${j.error ?? res.status}`);
      } else {
        setOpen(false);
        setForm({ fullName: "", telegramHandle: "", country: "", roleKey: "", whyText: "" });
        onDone();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>
        + Add candidate
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 font-display text-lg font-bold">Add candidate</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Full name *</label>
                <input
                  className="input"
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  placeholder="Maria Santos"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Telegram</label>
                  <input
                    className="input"
                    value={form.telegramHandle}
                    onChange={(e) => set("telegramHandle", e.target.value)}
                    placeholder="@handle"
                  />
                </div>
                <div>
                  <label className="label">Country</label>
                  <input
                    className="input"
                    value={form.country}
                    onChange={(e) => set("country", e.target.value)}
                    placeholder="PH"
                  />
                </div>
              </div>
              <div>
                <label className="label">Role (optional — leave blank to send first-touch)</label>
                <select className="input" value={form.roleKey} onChange={(e) => set("roleKey", e.target.value)}>
                  <option value="">— No role yet (APPLIED) —</option>
                  {roleOptions.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Why this role</label>
                <textarea
                  className="input min-h-[70px]"
                  value={form.whyText}
                  onChange={(e) => set("whyText", e.target.value)}
                  placeholder="Their strength + why…"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary btn-sm" disabled={saving || !form.fullName.trim()} onClick={submit}>
                {saving ? "Adding…" : "Add candidate"}
              </button>
            </div>
            <p className="mt-3 text-[11px] text-muted">
              With a role selected, training auto-sends (ROLE_SELECTED). Without one, the first-touch
              “which role + why” message is sent.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
