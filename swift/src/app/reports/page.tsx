import { getReportData } from "@/lib/reports";
import { Tier } from "@/lib/constants";

export const dynamic = "force-dynamic";

const tierBar: Record<Tier, string> = {
  A: "bg-good",
  B: "bg-brand",
  C: "bg-warn",
  REJECT: "bg-bad",
};

function fmtHrs(h: number | null): string {
  if (h == null) return "—";
  if (h >= 48) return `${Math.round(h / 24)}d`;
  if (h >= 1) return `${Math.round(h)}h`;
  return `${Math.round(h * 60)}m`;
}

export default async function ReportsPage() {
  const r = await getReportData();
  const funnelMax = Math.max(1, ...r.funnel.map((f) => f.count));
  const tierMax = Math.max(1, ...r.tiers.map((t) => t.count));
  const bucketMax = Math.max(1, ...r.buckets.map((b) => b.count));
  const hasScores = r.totals.scored > 0;

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Reports</h1>
      <p className="mb-5 text-sm text-muted">
        Funnel conversion, score distribution and time-to-hire — computed from real trials, scorecards and
        hires, so the numbers hold up even before any stage history exists.
      </p>

      {/* Headline stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Overall conversion"
          value={`${r.conversion.overall}%`}
          sub={`${r.totals.hires} hired of ${r.totals.candidates} applied`}
        />
        <Stat
          label="Avg score"
          value={r.avgScore == null ? "—" : `${r.avgScore}/100`}
          sub={r.avgAutoRating == null ? "no watcher data" : `watcher avg ${r.avgAutoRating}/10`}
        />
        <Stat
          label="Avg time to hire"
          value={fmtHrs(r.timing.avgTimeToHireHrs)}
          sub={
            r.timing.hiresCounted > 0
              ? `median ${fmtHrs(r.timing.medianTimeToHireHrs)} · n=${r.timing.hiresCounted}`
              : "no hires yet"
          }
        />
        <Stat
          label="Scoring turnaround"
          value={fmtHrs(r.timing.avgScoringTurnaroundHrs)}
          sub="submitted → scored"
        />
      </div>

      {/* Funnel */}
      <section className="card mb-6 p-4">
        <h2 className="mb-3 font-display text-base font-semibold">Hiring funnel</h2>
        <div className="space-y-3">
          {r.funnel.map((f) => (
            <div key={f.key}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">{f.label}</span>
                <span className="text-muted">
                  {f.count} · {f.pct}%
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-panel2">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${(f.count / funnelMax) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs text-muted sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-panel2 p-2">
            <div className="font-display text-lg font-bold text-gray-100">{r.conversion.applyToTrial}%</div>
            apply → trial
          </div>
          <div className="rounded-lg border border-line bg-panel2 p-2">
            <div className="font-display text-lg font-bold text-gray-100">{r.conversion.trialToSubmit}%</div>
            trial → submit
          </div>
          <div className="rounded-lg border border-line bg-panel2 p-2">
            <div className="font-display text-lg font-bold text-gray-100">{r.conversion.submitToHire}%</div>
            submit → hire
          </div>
          <div className="rounded-lg border border-line bg-panel2 p-2">
            <div className="font-display text-lg font-bold text-gray-100">{r.conversion.overall}%</div>
            overall
          </div>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Tier outcomes */}
        <section className="card p-4">
          <h2 className="mb-3 font-display text-base font-semibold">Tier outcomes ({r.totals.scored})</h2>
          {hasScores ? (
            <div className="space-y-3">
              {r.tiers.map((t) => (
                <div key={t.tier}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{t.tier}</span>
                    <span className="text-muted">
                      {t.count} · {t.pct}%
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-panel2">
                    <div
                      className={`h-full rounded-full ${tierBar[t.tier]}`}
                      style={{ width: `${(t.count / tierMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No finalized scores yet.</p>
          )}
        </section>

        {/* Score distribution */}
        <section className="card p-4">
          <h2 className="mb-3 font-display text-base font-semibold">Score distribution</h2>
          {hasScores ? (
            <div className="space-y-3">
              {r.buckets.map((b) => (
                <div key={b.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{b.label}</span>
                    <span className="text-muted">{b.count}</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-panel2">
                    <div
                      className="h-full rounded-full bg-brand2"
                      style={{ width: `${(b.count / bucketMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No finalized scores yet.</p>
          )}
        </section>
      </div>

      {/* Per-role breakdown */}
      <section className="card p-4">
        <h2 className="mb-3 font-display text-base font-semibold">By role</h2>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-right font-medium">Applied</th>
                <th className="px-3 py-2 text-right font-medium">Submitted</th>
                <th className="px-3 py-2 text-right font-medium">Scored</th>
                <th className="px-3 py-2 text-right font-medium">Avg score</th>
              </tr>
            </thead>
            <tbody>
              {r.roles.map((row) => (
                <tr key={row.roleId} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{row.role}</td>
                  <td className="px-3 py-2 text-right text-muted">{row.applied}</td>
                  <td className="px-3 py-2 text-right text-muted">{row.submitted}</td>
                  <td className="px-3 py-2 text-right text-muted">{row.scored}</td>
                  <td className="px-3 py-2 text-right">{row.avgScore == null ? "—" : row.avgScore}</td>
                </tr>
              ))}
              {r.roles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted">
                    No roles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
