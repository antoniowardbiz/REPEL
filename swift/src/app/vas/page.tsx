import { prisma } from "@/lib/db";
import { balanceReport } from "@/lib/distribution";
import { roleAvailability } from "@/lib/capacity";
import { AUTO_HIRE } from "@/lib/services";
import { ROLE_PAY } from "@/lib/roles-config";
import RoleCapacityEditor from "@/components/RoleCapacityEditor";
import RolePayEditor from "@/components/RolePayEditor";
import AssignmentPromoLink from "@/components/AssignmentPromoLink";
import ModelLinksEditor from "@/components/ModelLinksEditor";

export const dynamic = "force-dynamic";

export default async function VasPage() {
  const [report, assignments, availability, creators, managers, roles] = await Promise.all([
    balanceReport(),
    prisma.assignment.findMany({
      where: { status: { in: ["probation", "active"] } },
      include: { user: true, creator: true, role: true },
      orderBy: { createdAt: "desc" },
    }),
    roleAvailability(),
    prisma.creator.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { role: "manager", status: "active" },
      include: { managesModels: { include: { creator: true } }, managedRoles: true },
      orderBy: { name: "asc" },
    }),
    prisma.role.findMany({ where: { active: true }, orderBy: { displayName: "asc" } }),
  ]);

  const managerRows = managers.map((u) => ({
    name: u.name,
    handle: u.telegramHandle,
    models: u.managesModels.map((cm) => cm.creator.name).sort(),
    reddit: u.managedRoles.some((r) => r.key === "reddit_va"),
    x: u.managedRoles.some((r) => r.key === "x_va"),
  }));

  const modelRows = creators.map((c) => {
    let drives: Record<string, string> = {};
    try {
      drives = c.contentDrives ? JSON.parse(c.contentDrives) : {};
    } catch {
      drives = {};
    }
    return {
      id: c.id,
      name: c.name,
      xMainUrl: c.xMainUrl ?? "",
      // Per-role drives, falling back to the general drive so existing links show.
      driveX: drives.x_va ?? c.contentDriveUrl ?? "",
      driveReddit: drives.reddit_va ?? c.contentDriveUrl ?? "",
    };
  });

  const capacityRows = availability
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((r) => ({
      key: r.key,
      displayName: r.displayName,
      capacity: r.capacity,
      load: r.load,
      remaining: r.remaining,
      open: r.open,
      recent: r.recent,
    }));
  const topNeed = availability.find((r) => r.open) ?? null;

  // Pay line per role — the DB value when an operator has set one, else the
  // built-in default. Saved live from the dashboard (no deploy).
  const payRows = roles.map((r) => ({
    key: r.key,
    displayName: r.displayName,
    pay: r.pay ?? ROLE_PAY[r.key] ?? "",
    custom: r.pay != null,
  }));

  const max = Math.max(1, ...report.loads.map((l) => l.count));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">VAs &amp; Models</h1>
      <p className="mb-5 text-sm text-muted">
        Even distribution across models. New hires auto-assign to the least-loaded model so the split stays
        balanced.
      </p>

      {/* Models: content drives + main pages (feed briefs, onboarding & AI answers) */}
      <section className="card mb-6 p-4">
        <h2 className="mb-1 font-display text-base font-semibold">Models — drives &amp; links</h2>
        <p className="mb-3 text-sm text-muted">
          These links flow straight into trial briefs, the onboarding welcome and the AI support
          agent. Edit + Save — live immediately, no deploy.
        </p>
        <ModelLinksEditor models={modelRows} />
      </section>

      {/* Managers roster: who oversees which models + the Reddit team */}
      <section className="card mb-6 p-4">
        <h2 className="mb-1 font-display text-base font-semibold">Managers</h2>
        <p className="mb-3 text-sm text-muted">Who oversees which models, plus the Reddit VA manager.</p>
        <div className="space-y-2">
          {managerRows.map((m) => (
            <div
              key={m.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel2 p-2.5"
            >
              <div>
                <span className="text-sm font-semibold">{m.name}</span>
                {m.handle && <span className="ml-2 font-mono text-[11px] text-muted">{m.handle}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {m.reddit && <span className="pill bg-brand/15 text-brand">Reddit VAs</span>}
                {m.x && <span className="pill bg-brand/15 text-brand">X VAs</span>}
                {m.models.map((mn) => (
                  <span key={mn} className="badge">
                    {mn}
                  </span>
                ))}
                {m.models.length === 0 && !m.reddit && !m.x && <span className="text-[11px] text-muted">—</span>}
              </div>
            </div>
          ))}
          {managerRows.length === 0 && <p className="text-sm text-muted">No managers yet.</p>}
        </div>
      </section>

      {/* Mass-hire: role headcount targets + steering */}
      <section className="card mb-6 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold">Role headcount &amp; steering</h2>
          <span
            className={`pill ${
              AUTO_HIRE
                ? "bg-good/15 text-good border border-good/40"
                : "bg-panel2 text-muted border border-line"
            }`}
          >
            {AUTO_HIRE ? "auto-hire ON" : "auto-hire off"}
          </span>
        </div>
        <p className="mb-3 text-sm text-muted">
          Everyone still picks their role. When a role hits its target it{" "}
          <span className="text-white">closes on the apply form</span> and new pickers are steered to the
          role that needs people most. Blank target = unlimited.
          {topNeed && (
            <>
              {" "}
              Right now we most need <span className="text-white">{topNeed.displayName}</span>.
            </>
          )}
        </p>
        <RoleCapacityEditor rows={capacityRows} />
      </section>

      {/* Pay per role: the pay line VAs actually see in their welcome + from the bot */}
      <section className="card mb-6 p-4">
        <h2 className="mb-1 font-display text-base font-semibold">Pay per role</h2>
        <p className="mb-3 text-sm text-muted">
          The exact pay line each VA sees in their welcome message and whenever the bot answers a pay
          question. Edit + Save — live immediately, no deploy. Blank resets to the built-in default.
        </p>
        <RolePayEditor rows={payRows} />
      </section>

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
                <th className="px-3 py-2 text-left font-medium">Their link (Infloww)</th>
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
                  <td className="px-3 py-2" style={{ minWidth: 220 }}>
                    <AssignmentPromoLink id={a.id} promoLink={a.promoLink ?? ""} />
                  </td>
                </tr>
              ))}
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted">
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
