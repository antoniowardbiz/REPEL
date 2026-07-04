import { prisma } from "@/lib/db";
import { ROLE_PLATFORM } from "@/lib/roles-config";
import CopyLink from "@/components/CopyLink";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function ago(d: Date | null): string {
  if (!d) return "—";
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const PLATFORM_LABEL: Record<string, string> = {
  x: "X",
  reddit: "Reddit",
  instagram: "IG",
  tiktok: "TikTok",
};

export default async function LinksPage() {
  const weekAgo = new Date(Date.now() - 7 * DAY);

  const [assignments, totalAgg, weekAgg, lastAgg] = await Promise.all([
    prisma.assignment.findMany({
      where: { status: { in: ["probation", "active"] } },
      include: { user: true, creator: true, role: true },
    }),
    prisma.activityEvent.groupBy({
      by: ["userId"],
      where: { type: "promo_click", userId: { not: null } },
      _count: { _all: true },
    }),
    prisma.activityEvent.groupBy({
      by: ["userId"],
      where: { type: "promo_click", userId: { not: null }, createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    prisma.activityEvent.groupBy({
      by: ["userId"],
      where: { type: "promo_click", userId: { not: null } },
      _max: { createdAt: true },
    }),
  ]);

  const totalBy = new Map(totalAgg.map((c) => [c.userId as string, c._count._all]));
  const weekBy = new Map(weekAgg.map((c) => [c.userId as string, c._count._all]));
  const lastBy = new Map(lastAgg.map((c) => [c.userId as string, c._max.createdAt as Date | null]));

  const rows = assignments
    .map((a) => ({
      id: a.id,
      name: a.user.name,
      model: a.creator.name,
      platform: ROLE_PLATFORM[a.role.key] ?? "",
      link: a.promoLink ?? "",
      label: a.trialLinkLabel ?? "",
      total: totalBy.get(a.userId) ?? 0,
      week: weekBy.get(a.userId) ?? 0,
      last: lastBy.get(a.userId) ?? null,
    }))
    .sort((x, y) => y.total - x.total || y.week - x.week || x.name.localeCompare(y.name));

  const totalClicks = rows.reduce((s, r) => s + r.total, 0);
  const weekClicks = rows.reduce((s, r) => s + r.week, 0);
  const liveLinks = rows.filter((r) => r.link).length;
  const zeroClicks = rows.filter((r) => r.link && r.total === 0).length;
  const missingLinks = rows.filter((r) => !r.link).length;

  const tiles = [
    { label: "Clicks (all-time)", value: totalClicks },
    { label: "Clicks (7 days)", value: weekClicks },
    { label: "Live links", value: liveLinks },
    { label: "0 clicks yet", value: zeroClicks, warn: zeroClicks > 0 },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Links &amp; Clicks</h1>
      <p className="mb-4 text-sm text-muted">
        Every VA&rsquo;s personal tracked link and how many times it&rsquo;s been clicked. Top clickers first.
      </p>

      {/* How tracking works — the thing that trips everyone up */}
      <div className="mb-5 rounded-lg border border-brand/40 bg-brand/10 p-3 text-sm">
        <span className="font-semibold text-white">Clicks only count the tracked link.</span>{" "}
        <span className="text-muted">
          A click is logged when someone opens the VA&rsquo;s{" "}
          <span className="font-mono text-[12px] text-white">/go/&hellip;</span> link. If a VA posts a raw
          OnlyFans or Infloww link instead, it won&rsquo;t show here. Give each VA the link below (or the bot
          sends it when they message <span className="font-mono text-[12px] text-white">link</span>).
        </span>
      </div>

      {/* Summary tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-3">
            <div className="text-[11px] uppercase tracking-wide text-faint">{t.label}</div>
            <div className={`font-display text-2xl ${t.warn ? "text-warn" : ""}`}>{t.value}</div>
          </div>
        ))}
      </div>

      {missingLinks > 0 && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          {missingLinks} active VA{missingLinks === 1 ? " has" : "s have"} no tracked link yet. Open{" "}
          <span className="font-semibold">VAs &amp; Models</span> and hit{" "}
          <span className="font-semibold">Backfill promo links</span> to generate them.
        </div>
      )}

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold">Every VA ({rows.length})</h2>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">VA</th>
                <th className="px-3 py-2 text-left font-medium">Platform</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-right font-medium">Clicks</th>
                <th className="px-3 py-2 text-right font-medium">7&nbsp;days</th>
                <th className="px-3 py-2 text-left font-medium">Last click</th>
                <th className="px-3 py-2 text-left font-medium">Infloww</th>
                <th className="px-3 py-2 text-left font-medium">Tracked link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-[11px] text-faint">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">
                    {r.platform ? (
                      <span className="pill bg-panel2 text-muted">{PLATFORM_LABEL[r.platform] ?? r.platform}</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.model}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.total > 0 ? <span className="text-white">{r.total}</span> : <span className="text-faint">0</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{r.week || ""}</td>
                  <td className="px-3 py-2 text-[12px] text-muted">{ago(r.last)}</td>
                  <td className="px-3 py-2">
                    {r.label ? (
                      <span className="pill bg-panel2 font-mono text-[11px] text-good">{r.label}</span>
                    ) : (
                      <span className="text-[11px] text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <CopyLink url={r.link} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-muted">
                    No active VAs yet.
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
