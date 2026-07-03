"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STAGES, Stage } from "@/lib/constants";

const SENDABLE = [
  { category: "first_touch", label: "First touch (which role + why)" },
  { category: "training", label: "Training link" },
  { category: "brief", label: "Trial brief" },
  { category: "offer", label: "Offer (A/B)" },
  { category: "retrial", label: "Re-trial (C)" },
  { category: "decline", label: "Decline (REJECT)" },
];

export default function CandidateActions({
  candidateId,
  archived,
  primaryApplicationId,
  primaryStage,
  primaryTrialStatus,
  roleOptions,
}: {
  candidateId: string;
  archived: boolean;
  primaryApplicationId: string | null;
  primaryStage: Stage | null;
  primaryTrialStatus: string | null;
  roleOptions: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // forms
  const [roleKey, setRoleKey] = useState("");
  const [why, setWhy] = useState("");
  const [stage, setStage] = useState<Stage | "">(primaryStage ?? "");
  const [category, setCategory] = useState("brief");
  const [urls, setUrls] = useState("");
  const [account, setAccount] = useState("");

  async function call(url: string, body: any, method = "POST") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`⚠ ${j.error ?? res.status}`);
      } else {
        setMsg("✓ done");
        router.refresh();
      }
      return { res, j };
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!primaryApplicationId ? (
        <section className="card p-4">
          <h3 className="mb-2 font-display text-sm font-semibold">Select role</h3>
          <p className="mb-2 text-xs text-muted">Creates the application & auto-sends training.</p>
          <select className="input mb-2" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            <option value="">— choose a role —</option>
            {roleOptions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          <textarea
            className="input mb-2 min-h-[60px]"
            placeholder="Why this role (optional)"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
          <button
            className="btn-primary btn-sm w-full"
            disabled={busy || !roleKey}
            onClick={() => call(`/api/candidates/${candidateId}/select-role`, { roleKey, whyText: why })}
          >
            Select role &amp; send training
          </button>
        </section>
      ) : (
        <>
          <section className="card p-4">
            <h3 className="mb-2 font-display text-sm font-semibold">Move stage</h3>
            <div className="flex gap-2">
              <select className="input" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                className="btn-primary btn-sm"
                disabled={busy || !stage || stage === primaryStage}
                onClick={() => call(`/api/applications/${primaryApplicationId}/stage`, { to: stage })}
              >
                Move
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              ROLE_SELECTED → training · TRIAL_READY → brief + clock · SUBMITTED → scorer queue
            </p>
            <button
              className="btn-primary btn-sm mt-3 w-full"
              disabled={busy}
              onClick={() => call(`/api/applications/${primaryApplicationId}/onboard`, {})}
            >
              ⚡ Onboard now — hire + auto-hand an account
            </button>
            <p className="mt-1.5 text-[11px] text-muted">
              Skips the trial: creates their VA record, assigns a model, hands them a pool account, and DMs
              their setup + promo link. Then they show up on the Accounts page.
            </p>
          </section>

          <section className="card p-4">
            <h3 className="mb-2 font-display text-sm font-semibold">Quick-send</h3>
            <div className="flex gap-2">
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {SENDABLE.map((s) => (
                  <option key={s.category} value={s.category}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  category === "first_touch"
                    ? call(`/api/messages/send`, { candidateId })
                    : call(`/api/messages/send`, { applicationId: primaryApplicationId, category })
                }
              >
                Send
              </button>
            </div>
          </section>

          {(primaryStage === "TRIAL_READY" || primaryStage === "TRIAL_ACTIVE" || primaryTrialStatus === "active") && (
            <section className="card p-4">
              <h3 className="mb-2 font-display text-sm font-semibold">Submit trial</h3>
              <input
                className="input mb-2"
                placeholder="Account used (e.g. @handle)"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              />
              <textarea
                className="input mb-2 min-h-[70px]"
                placeholder="Submission links (one per line)"
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
              />
              <button
                className="btn-primary btn-sm w-full"
                disabled={busy || !urls.trim()}
                onClick={() =>
                  call(`/api/applications/${primaryApplicationId}/submit`, {
                    submissionUrls: urls,
                    accountUsed: account || undefined,
                  })
                }
              >
                Submit &amp; queue for scoring
              </button>
            </section>
          )}
        </>
      )}

      <section className="card p-4">
        <button
          className="btn-ghost btn-sm w-full"
          disabled={busy}
          onClick={() => call(`/api/candidates/${candidateId}`, { archived: !archived }, "PATCH")}
        >
          {archived ? "Unarchive candidate" : "Archive candidate"}
        </button>
      </section>

      {msg && <p className="text-center text-xs text-muted">{msg}</p>}
    </div>
  );
}
