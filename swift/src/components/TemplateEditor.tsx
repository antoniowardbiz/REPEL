"use client";

import { useState } from "react";

type T = {
  id: string;
  key: string;
  category: string;
  subject: string;
  body: string;
  roleLabel: string | null;
  active: boolean;
};

function Card({ t }: { t: T }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = subject !== t.subject || body !== t.body;

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      if (res.ok) {
        setSaved(true);
        t.subject = subject;
        t.body = body;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <span className="font-mono text-sm font-semibold">{t.key}</span>
          <span className="ml-2 pill bg-panel2 text-muted">{t.category}</span>
          {t.roleLabel && <span className="ml-1 pill bg-panel2 text-muted">{t.roleLabel}</span>}
        </div>
        <button className="btn-primary btn-sm" disabled={busy || !dirty} onClick={save}>
          {busy ? "Saving…" : saved && !dirty ? "Saved ✓" : "Save"}
        </button>
      </div>
      <input
        className="input mb-2"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject / internal label"
      />
      <textarea className="input min-h-[150px] font-mono text-[13px]" value={body} onChange={(e) => setBody(e.target.value)} />
    </div>
  );
}

export default function TemplateEditor({ templates }: { templates: T[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {templates.map((t) => (
        <Card key={t.id} t={t} />
      ))}
    </div>
  );
}
