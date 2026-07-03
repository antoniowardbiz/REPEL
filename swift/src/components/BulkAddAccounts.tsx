"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_PLATFORMS } from "@/lib/constants";

type CreatorLite = { id: string; name: string };

// Paste a batch of bought accounts (one login per line) straight into the pool.
// Each line is a credential like "username:password"; the handle is read from
// the part before the first ":". Held in the pool until a VA claims one.
export default function BulkAddAccounts({ creators }: { creators: CreatorLite[] }) {
  const router = useRouter();
  const [platform, setPlatform] = useState("reddit");
  const [creatorId, setCreatorId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length;

  async function submit() {
    if (lineCount === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/accounts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, creatorId: creatorId || null, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`✓ Added ${data.created ?? 0} to the pool${data.skipped ? ` (${data.skipped} skipped as duplicates)` : ""}.`);
        setText("");
        router.refresh();
      } else {
        setMsg(`⚠ ${data.error ?? "Failed"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-6 p-4">
      <h2 className="mb-1 font-display text-base font-semibold">Load accounts into the pool</h2>
      <p className="mb-3 text-sm text-muted">
        Paste your bought accounts — <span className="text-white">one per line</span> (e.g.{" "}
        <span className="font-mono text-[12px]">username:password</span>). They sit in the pool until a VA
        claims one, then that account drops out automatically.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Platform</label>
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {ACCOUNT_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Model (optional)</label>
          <select className="input" value={creatorId} onChange={(e) => setCreatorId(e.target.value)}>
            <option value="">— any / unassigned —</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={busy || lineCount === 0} onClick={submit}>
            {busy ? "Adding…" : `Add ${lineCount || ""} to pool`}
          </button>
        </div>
      </div>
      <textarea
        className="input mt-3 h-32 w-full font-mono text-[12px]"
        placeholder={"username1:password1\nusername2:password2\n…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
    </section>
  );
}
