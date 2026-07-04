// Earnings & commission: SWIFT can't read Infloww's revenue directly (no API),
// but every VA's link has a label (LAE-X-1) that appears in Infloww's export.
// Paste that export here and we match each row's label back to its VA, store the
// subs + earnings, and compute commission — so you get per-VA revenue and know
// exactly what to pay, using the links you already set up.

import { prisma } from "./db";

/** Commission rate as a % of a VA's earnings (env COMMISSION_PCT, default 20). */
export function commissionPct(): number {
  const p = Number(process.env.COMMISSION_PCT);
  return Number.isFinite(p) && p >= 0 && p <= 100 ? p : 20;
}

type ParsedRow = { label: string; subs: number; earningsCents: number };

/**
 * Parse pasted Infloww data. Each line is scanned for a link label (e.g.
 * LAE-X-1), a claim/subs count (Infloww's "14/∞" format), and the earnings (the
 * LAST dollar amount on the line — Infloww's Earnings column). Tolerant of the
 * CSV export or a hand-typed "LABEL 14/∞ $188" line.
 */
export function parseEarnings(text: string): { rows: ParsedRow[]; skipped: string[] } {
  const rows: ParsedRow[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const labelM = line.match(/\b([A-Za-z]{2,12})-([RXrx])-(\d+)\b/);
    if (!labelM) {
      skipped.push(`${line.slice(0, 40)} — no link label found`);
      continue;
    }
    const label = labelM[0].toUpperCase();
    // Subs = the claim count. Infloww shows "14/∞" (claimed / limit). Strip any
    // date first (YYYY/MM/DD also has slashes) so it can't be mistaken for a claim.
    const noDate = line.replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, " ");
    const subsM = noDate.match(/(\d+)\s*\/\s*(?:∞|\d+)/);
    const subs = subsM ? parseInt(subsM[1], 10) : 0;
    // Earnings = the last dollar amount (Infloww's Earnings is the final $ col).
    const dollars = [...line.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)];
    const earnStr = dollars.length ? dollars[dollars.length - 1][1].replace(/,/g, "") : null;
    const earningsCents = earnStr ? Math.round(parseFloat(earnStr) * 100) : 0;
    rows.push({ label, subs, earningsCents });
  }
  return { rows, skipped };
}

/**
 * Import earnings: parse, match each label to its VA's assignment, store the
 * subs + earnings. Returns a preview (so you can verify the match) plus any
 * labels that didn't match a VA.
 */
export async function importEarnings(text: string): Promise<{
  updated: number;
  unmatched: string[];
  skipped: string[];
  preview: { label: string; vaName: string | null; subs: number; earnings: number }[];
}> {
  const { rows, skipped } = parseEarnings(text);
  const unmatched: string[] = [];
  const preview: { label: string; vaName: string | null; subs: number; earnings: number }[] = [];
  let updated = 0;
  for (const r of rows) {
    const asg = await prisma.assignment.findFirst({
      where: { trialLinkLabel: r.label },
      include: { user: { include: { fromCandidate: true } } },
    });
    if (!asg) {
      unmatched.push(r.label);
      preview.push({ label: r.label, vaName: null, subs: r.subs, earnings: r.earningsCents / 100 });
      continue;
    }
    await prisma.assignment.update({
      where: { id: asg.id },
      data: { subs: r.subs, earningsCents: r.earningsCents, earningsSyncedAt: new Date() },
    });
    updated++;
    preview.push({
      label: r.label,
      vaName: asg.user?.fromCandidate?.fullName ?? asg.user?.name ?? "VA",
      subs: r.subs,
      earnings: r.earningsCents / 100,
    });
  }
  return { updated, unmatched, skipped, preview };
}

/** Per-VA subs, earnings and commission owed — sorted by earnings (top first). */
export async function earningsLeaderboard() {
  const pct = commissionPct();
  const asgs = await prisma.assignment.findMany({
    where: { status: { in: ["probation", "active"] } },
    include: { user: { include: { fromCandidate: true } }, creator: true, role: true },
  });
  const rows = asgs.map((a) => ({
    name: a.user?.fromCandidate?.fullName ?? a.user?.name ?? "VA",
    model: a.creator.name,
    role: a.role.displayName,
    label: a.trialLinkLabel,
    subs: a.subs,
    earnings: a.earningsCents / 100,
    commission: Math.round((a.earningsCents * pct) / 100) / 100,
    syncedAt: a.earningsSyncedAt,
  }));
  rows.sort((x, y) => y.earnings - x.earnings || y.subs - x.subs || x.name.localeCompare(y.name));
  const totals = rows.reduce(
    (t, r) => ({ subs: t.subs + r.subs, earnings: t.earnings + r.earnings, commission: t.commission + r.commission }),
    { subs: 0, earnings: 0, commission: 0 }
  );
  return { pct, rows, totals };
}
