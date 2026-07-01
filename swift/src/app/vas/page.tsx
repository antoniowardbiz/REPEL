import { prisma } from "@/lib/db";
import { balanceReport } from "@/lib/distribution";

export const dynamic = "force-dynamic";

export default async function VasPage() {
  const [report, assignments] = await Promise.all([
    balanceReport(),
    prisma.assignment.findMany({
      where: { status: { in: ["probation", "active"] } },
      include: { user: true, creator: true, role: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const max = Math.max(1, ...report.loads.map((l) => l.count));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">VAs &amp; Models</h1>
      <p className="mb-5 text-sm text-muted">
        Even distribution across models. New hires auto-assign to the least-loaded model so the split stays
        balanced.
      </p>

      {/* Distribution */}
      <section className="card mb-6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Distribution ({report.total} active VAs)</h2>
          <span
            className={`pill ${
              report.balanced
                ? "bg-good/15 text-good border border-good/40"
                : "bg-warn/15 text-warn border border-warn/40"
            }`}
          >
            {report.balanced ? "balanced ✓" : `imbalance: ${report.spread}`}
          </span>
        </div>
        <div className="space-y-3">
          {report.loads.map((l) => (
            <div key={l.creatorId}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">{l.name}</span>
                <span className="text-muted">
                  {l.count} VA{l.count === 1 ? "" : "s"} · {Math.round(l.share * 100)}%
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-panel2">
                <div className="h-full rounded-full bg-brand" style={{ width: `${(l.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
          {report.loads.length === 0 && <p className="text-sm text-muted">No active models.</p>}
        </div>
      </section>

      {/* Assignments */}
      <section className="card p-4">
        <h2 className="mb-3 font-display text-base font-semibold">Active assignments ({assignments.length})</h2>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">VA</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{a.user.name}</td>
                  <td className="px-3 py-2 text-muted">{a.role.displayName}</td>
                  <td className="px-3 py-2">{a.creator.name}</td>
                  <td className="px-3 py-2">
                    <span className="pill bg-panel2 text-muted">{a.status}</span>
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-muted">
                    No assignments yet — VAs are assigned automatically when hired (Onboarding).
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
