import { build48hReview } from "@/lib/review";

export const dynamic = "force-dynamic";

function ago(d: Date | null): string {
  if (!d) return "—";
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function when(d: Date): string {
  const hrs = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  return hrs < 1 ? "just now" : hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

const VERDICT_STYLE: Record<string, string> = {
  conversion: "border-warn/50 bg-warn/10 text-warn",
  traffic: "border-warn/50 bg-warn/10 text-warn",
  flowing: "border-good/50 bg-good/10 text-good",
  empty: "border-line bg-panel2 text-muted",
};

export default async function ReviewPage() {
  const r = await build48hReview(48);

  const tiles = [
    { label: "Active VAs", value: r.totals.activeVas },
    { label: "Hired (48h)", value: r.totals.hired48 },
    { label: "New applicants (48h)", value: r.totals.newApplicants48 },
    { label: "Clicks (48h)", value: r.totals.clicks48 },
    { label: "Subs (all-time)", value: r.totals.subsAll, warn: r.totals.subsAll === 0 },
    { label: "Missing links", value: r.totals.missingLink, warn: r.totals.missingLink > 0 },
    { label: "Trials submitted (48h)", value: r.totals.trialsSubmitted48 },
    { label: "Trials expired (48h)", value: r.totals.trialsExpired48, warn: r.totals.trialsExpired48 > 0 },
  ];

  const funnelMax = Math.max(1, ...r.funnel.map((f) => f.total));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">48-Hour Review</h1>
      <p className="mb-4 text-sm text-muted">
        Everything that happened in the last {r.window.hours}h — who came through, who&rsquo;s stuck, what the
        system said to each VA, and the clicks-vs-subs read that says whether it&rsquo;s a traffic or a
        conversion problem.
      </p>

      {/* Headline verdict — the "why zero subs" answer */}
      <div className={`mb-5 rounded-lg border p-4 ${VERDICT_STYLE[r.verdict.kind]}`}>
        <div className="font-display text-base font-semibold">{r.verdict.headline}</div>
        <div className="mt-1 text-sm opacity-90">{r.verdict.detail}</div>
      </div>

      {/* Totals */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-3">
            <div className="text-[11px] uppercase tracking-wide text-faint">{t.label}</div>
            <div className={`font-display text-2xl ${t.warn ? "text-warn" : ""}`}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Funnel snapshot */}
        <section className="card p-4">
          <h2 className="mb-3 font-display text-base font-semibold">Pipeline right now</h2>
          <div className="space-y-1.5">
            {r.funnel.map((f) => (
              <div key={f.stage} className="flex items-center gap-2">
                <div className="w-28 shrink-0 text-[12px] text-muted">{f.label}</div>
                <div className="h-4 flex-1 overflow-hidden rounded bg-panel2">
                  <div
                    className={`h-full ${f.total > 0 ? "bg-brand" : ""}`}
                    style={{ width: `${(f.total / funnelMax) * 100}%` }}
                  />
                </div>
                <div className="w-8 shrink-0 text-right font-mono text-[12px] tabular-nums">{f.total}</div>
              </div>
            ))}
          </div>
        </section>

        {/* What the system sent */}
        <section className="card p-4">
          <h2 className="mb-3 font-display text-base font-semibold">What the system messaged (48h)</h2>
          {r.systemMessages.length === 0 ? (
            <p className="text-sm text-muted">No outbound messages sent in the window — the automation was quiet.</p>
          ) : (
            <div className="space-y-1.5">
              {r.systemMessages.map((m) => (
                <div key={m.key} className="flex items-center justify-between text-sm">
                  <span className="text-muted">{m.label}</span>
                  <span className="font-mono tabular-nums">{m.count}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 border-t border-line pt-2 text-[12px] text-faint">
            Watcher: {r.watcher.observations48} observation{r.watcher.observations48 === 1 ? "" : "s"} ·{" "}
            {r.watcher.activeWatches} active watch{r.watcher.activeWatches === 1 ? "" : "es"} ·{" "}
            {r.watcher.postsObserved48} posts seen
          </div>
        </section>
      </div>

      {/* Started in the window */}
      <section className="card mt-5 p-4">
        <h2 className="mb-3 font-display text-base font-semibold">Started in the last 48h ({r.started.length})</h2>
        {r.started.length === 0 ? (
          <p className="text-sm text-muted">No new VAs came through in the window.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {r.started.map((s, i) => (
              <div key={i} className="rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
                <div className="font-medium">{s.name}</div>
                <div className="text-[11px] text-faint">
                  {s.role} · {s.model} · {when(s.when)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Stuck — the meat */}
      <section className="card mt-5 p-4">
        <h2 className="mb-3 font-display text-base font-semibold">Stuck / needs attention ({r.stuck.length})</h2>
        {r.stuck.length === 0 ? (
          <p className="text-sm text-good">Nothing stuck — everyone&rsquo;s moving. 🎯</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-panel2 text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Who</th>
                  <th className="px-3 py-2 text-left font-medium">Where</th>
                  <th className="px-3 py-2 text-left font-medium">Why stuck</th>
                  <th className="px-3 py-2 text-left font-medium">Do this</th>
                </tr>
              </thead>
              <tbody>
                {r.stuck.map((s, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${s.severity === "high" ? "bg-warn" : "bg-faint"}`} />
                      <span className="font-medium">{s.name}</span>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted">
                      {s.stage}
                      {s.role ? ` · ${s.role}` : ""}
                      {s.since ? <div className="text-faint">{ago(s.since)}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-[12px]">{s.reason}</td>
                    <td className="px-3 py-2 text-[12px] text-muted">{s.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Per-VA activity */}
      <section className="card mt-5 p-4">
        <h2 className="mb-3 font-display text-base font-semibold">Every active VA — 48h activity ({r.vaActivity.length})</h2>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">VA</th>
                <th className="px-3 py-2 text-left font-medium">Slot</th>
                <th className="px-3 py-2 text-right font-medium">Subs</th>
                <th className="px-3 py-2 text-right font-medium">Clicks 48h</th>
                <th className="px-3 py-2 text-left font-medium">Link sent</th>
                <th className="px-3 py-2 text-left font-medium">Last activity</th>
                <th className="px-3 py-2 text-left font-medium">Last message from system</th>
              </tr>
            </thead>
            <tbody>
              {r.vaActivity.map((v, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-2">
                    <div className="font-medium">{v.name}</div>
                    <div className="text-[11px] text-faint">{v.model} · {v.platform}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="pill bg-panel2 font-mono text-[11px] text-muted">{v.slot}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {v.subs > 0 ? <span className="text-good">{v.subs}</span> : <span className="text-faint">0</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {v.clicks48 > 0 ? <span className="text-white">{v.clicks48}</span> : <span className="text-faint">0</span>}
                    {v.clicksAll > 0 && <span className="ml-1 text-[10px] text-faint">/{v.clicksAll} all</span>}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {v.linkSent ? <span className="text-good">✓ {ago(v.linkSent)}</span> : v.hasLink ? <span className="text-warn">not sent</span> : <span className="text-faint">no link</span>}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted">{ago(v.lastActivity)}</td>
                  <td className="px-3 py-2 text-[12px]">
                    {v.lastMsgAt ? (
                      <>
                        <span className="text-muted">{v.lastMsgKey ? msgLabelInline(v.lastMsgKey) : "message"}</span>
                        <span className="ml-1 text-faint">{ago(v.lastMsgAt)}</span>
                      </>
                    ) : (
                      <span className="text-faint">nothing in 48h</span>
                    )}
                  </td>
                </tr>
              ))}
              {r.vaActivity.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-muted">No active VAs yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// Inline label map (kept alongside the page so the table reads plainly).
const INLINE: Record<string, string> = {
  personal_link: "sent promo link",
  account_handout: "sent account login",
  profile_setup: "profile-setup steps",
  morning: "morning nudge",
  role_prompt: "asked role + why",
  manager_nudge: "nudged account step",
  trial_expired_reengage: "win-back",
  ai_support: "answered a question",
  human_fallback: "escalated to you",
  hire_holding: "hire holding",
};
function msgLabelInline(k: string): string {
  return INLINE[k] ?? k;
}
