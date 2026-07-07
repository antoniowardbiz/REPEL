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

  const [assignments, totalAgg, weekAgg, lastAgg, sentAgg] = await Promise.all([
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
    // "Link sent" is derived from the personal_link DM we log when a VA is sent
    // their link — no extra column needed. Latest send per candidate.
    prisma.message.groupBy({
      by: ["candidateId"],
      where: { templateKey: "personal_link" },
      _max: { createdAt: true },
    }),
  ]);

  const totalBy = new Map(totalAgg.map((c) => [c.userId as string, c._count._all]));
  const weekBy = new Map(weekAgg.map((c) => [c.userId as string, c._count._all]));
  const lastBy = new Map(lastAgg.map((c) => [c.userId as string, c._max.createdAt as Date | null]));
  const sentBy = new Map(sentAgg.map((m) => [m.candidateId as string, m._max.createdAt as Date | null]));

  const rows = assignments
    .map((a) => {
      const platform = ROLE_PLATFORM[a.role.key] ?? "";
      const platLabel = PLATFORM_LABEL[platform] ?? platform;
      return {
        id: a.id,
        name: a.user.name,
        model: a.creator.name,
        platform,
        platLabel,
        // Always show a clear slot: the exact Infloww label (e.g. LOLA-X-1) when a
        // pool link is assigned, else a generic MODEL·PLATFORM so it's never blank.
        slot: a.trialLinkLabel || `${a.creator.name.toUpperCase()}·${platLabel.toUpperCase()}`,
        hasInflowwLabel: Boolean(a.trialLinkLabel),
        // Show the RAW OnlyFans free-trial link the VA actually posts (their own
        // Infloww link, else the model's shared trial link) — not the /go wrapper.
        link: a.trialLinkUrl || a.creator.ofTrialUrl || "",
        subs: a.subs ?? 0,
        total: totalBy.get(a.userId) ?? 0,
        week: weekBy.get(a.userId) ?? 0,
        last: lastBy.get(a.userId) ?? null,
        sent: a.user.candidateId ? sentBy.get(a.user.candidateId) ?? null : null,
      };
    })
    .sort((x, y) => y.subs - x.subs || y.total - x.total || x.name.localeCompare(y.name));

  const totalClicks = rows.reduce((s, r) => s + r.total, 0);
  const totalSubs = rows.reduce((s, r) => s + r.subs, 0);
  const liveLinks = rows.filter((r) => r.link).length;
  const sentCount = rows.filter((r) => r.sent).length;
  const missingLinks = rows.filter((r) => !r.link).length;
  const notSent = rows.filter((r) => r.link && !r.sent).length;

  const tiles = [
    { label: "Subs driven (all-time)", value: totalSubs },
    { label: "Clicks (all-time)", value: totalClicks },
    { label: "Links sent", value: `${sentCount}/${rows.length}` },
    { label: "Missing links", value: missingLinks, warn: missingLinks > 0 },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Links &amp; Subs</h1>
      <p className="mb-4 text-sm text-muted">
        Each VA&rsquo;s raw OnlyFans free-trial link (what they post), whether it&rsquo;s been sent to them,
        and the subs it&rsquo;s driving.
      </p>

      {/* How attribution works now */}
      <div className="mb-5 rounded-lg border border-brand/40 bg-brand/10 p-3 text-sm">
        <span className="font-semibold text-white">Subs are attributed in Infloww, by link.</span>{" "}
        <span className="text-muted">
          VAs post their <span className="text-white">raw OnlyFans free-trial link</span> directly (no wrapper).
          Subs fill in here when you import Infloww earnings, matched by the slot label (e.g.{" "}
          <span className="font-mono text-[12px] text-white">LOLA-X-1</span>). The Clicks column only counted
          the old <span className="font-mono text-[12px] text-white">/go</span> links and will stay flat now.
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
          {missingLinks} active VA{missingLinks === 1 ? " has" : "s have"} no tracked link yet. These now
          generate automatically on deploy and daily — or hit{" "}
          <span className="font-semibold">Backfill promo links</span> on{" "}
          <span className="font-semibold">VAs &amp; Models</span> to do it right now.
        </div>
      )}
      {missingLinks === 0 && notSent > 0 && (
        <div className="mb-4 rounded-lg border border-line bg-panel2 p-3 text-sm text-muted">
          {notSent} VA{notSent === 1 ? "" : "s"} ha{notSent === 1 ? "s" : "ve"} a link but ha{notSent === 1 ? "sn" : "ven"}&rsquo;t
          been sent it. They&rsquo;re DM&rsquo;d automatically each day, or hit{" "}
          <span className="font-semibold">Send links</span> on VAs &amp; Models to send now.
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
                <th className="px-3 py-2 text-left font-medium">Slot</th>
                <th className="px-3 py-2 text-right font-medium">Subs</th>
                <th className="px-3 py-2 text-right font-medium">Clicks</th>
                <th className="px-3 py-2 text-left font-medium">Last click</th>
                <th className="px-3 py-2 text-left font-medium">Sent</th>
                <th className="px-3 py-2 text-left font-medium">Tracked link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-[11px] text-faint">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-faint">
                      {r.model} · {r.platLabel}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`pill font-mono text-[11px] ${
                        r.hasInflowwLabel ? "bg-panel2 text-good" : "bg-panel2 text-muted"
                      }`}
                    >
                      {r.slot}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.subs > 0 ? <span className="text-good">{r.subs}</span> : <span className="text-faint">0</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.total > 0 ? <span className="text-white">{r.total}</span> : <span className="text-faint">0</span>}
                    {r.week > 0 && <span className="ml-1 text-[10px] text-faint">+{r.week}/7d</span>}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted">{ago(r.last)}</td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.sent ? (
                      <span className="text-good">✓ {ago(r.sent)}</span>
                    ) : r.link ? (
                      <span className="text-warn">not sent</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <CopyLink url={r.link} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-muted">
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
