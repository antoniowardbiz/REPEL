"use client";

import { useState } from "react";

export default function ApplyForm({ roleOptions }: { roleOptions: { key: string; label: string }[] }) {
  const [form, setForm] = useState({
    fullName: "",
    telegramHandle: "",
    email: "",
    country: "",
    roleKey: "",
    whyText: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [botLink, setBotLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.fullName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, roleKey: form.roleKey || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setBotLink(j.botDeepLink ?? null);
        setDone(true);
      } else setError(j.error ?? "Something went wrong");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card p-6 text-center">
        <div className="text-3xl">🎉</div>
        <h2 className="mt-2 font-display text-lg font-semibold">Thanks — you&apos;re in the pipeline!</h2>
        {botLink ? (
          <>
            <p className="mt-1 text-sm text-muted">One tap to continue — message our bot and we&apos;ll take it from there:</p>
            <a href={botLink} target="_blank" className="btn-primary mt-3 inline-flex">
              Continue on Telegram →
            </a>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Watch your Telegram for the next step. If you didn&apos;t add a handle, reply to the OnlineJobs thread.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="space-y-3">
        <div>
          <label className="label">Full name *</label>
          <input className="input" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Telegram handle</label>
            <input className="input" value={form.telegramHandle} onChange={(e) => set("telegramHandle", e.target.value)} placeholder="@you" />
          </div>
          <div>
            <label className="label">Country</label>
            <input className="input" value={form.country} onChange={(e) => set("country", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <label className="label">Which role is your strong point?</label>
          <select className="input" value={form.roleKey} onChange={(e) => set("roleKey", e.target.value)}>
            <option value="">— not sure yet —</option>
            {roleOptions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">…and WHY?</label>
          <textarea className="input min-h-[90px]" value={form.whyText} onChange={(e) => set("whyText", e.target.value)} />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-bad">⚠ {error}</p>}
      <button className="btn-primary mt-4 w-full" disabled={busy || !form.fullName.trim()} onClick={submit}>
        {busy ? "Submitting…" : "Submit application"}
      </button>
    </div>
  );
}
