// Trial-link pool: bulk-import Infloww free-trial links, then auto-assign one
// per VA on hire (matching their model + platform) so every VA's /go link
// redirects to their OWN Infloww link — giving per-VA sub/earnings attribution.
// Links are tagged by their label (e.g. "LOLA-R-3" = Lola, reddit).

import { prisma } from "./db";
import { sendOpsAlert } from "./telegram";
import { ROLE_PLATFORM } from "./roles-config";

// Warn ops once a model+platform bucket drops to this many spare links.
const LOW_POOL_THRESHOLD = 3;

// Match a label prefix (e.g. "LOLA") to a Creator by name — tolerant of the
// model being stored as "Lola" or "Lola Belle".
function matchCreator(prefix: string, creators: { id: string; name: string }[]) {
  const p = prefix.toUpperCase();
  return creators.find((c) => {
    const n = c.name.toUpperCase();
    const first = n.split(/\s+/)[0];
    return n === p || n.startsWith(p) || p.startsWith(first) || first === p;
  });
}

/**
 * Import Infloww links from pasted text. Each line is scanned for a label
 * (PREFIX-R|X-N, e.g. LOLA-R-3) and a URL; the label gives the model + platform.
 * Robust to CSV/space/comma/tab formats — it just looks for the two tokens.
 * De-dupes on URL. Returns what landed and what was skipped (and why).
 */
export async function importTrialLinks(
  text: string
): Promise<{ imported: number; skipped: string[]; byBucket: Record<string, number> }> {
  const creators = await prisma.creator.findMany({ select: { id: true, name: true } });
  const skipped: string[] = [];
  const byBucket: Record<string, number> = {};
  let imported = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const labelM = line.match(/\b([A-Za-z]{2,12})-([RXrx])-(\d+)\b/);
    const urlM = line.match(/https?:\/\/[^\s,;"'<>]+/);
    if (!labelM || !urlM) {
      skipped.push(`${line.slice(0, 32)} — needs a LABEL and a URL`);
      continue;
    }
    const label = labelM[0].toUpperCase();
    const platform = labelM[2].toUpperCase() === "R" ? "reddit" : "x";
    const url = urlM[0];
    const creator = matchCreator(labelM[1], creators);
    if (!creator) {
      skipped.push(`${label} — no model matches "${labelM[1]}"`);
      continue;
    }
    if (await prisma.trialLink.findUnique({ where: { url } })) {
      skipped.push(`${label} — already imported`);
      continue;
    }
    await prisma.trialLink.create({ data: { label, url, creatorId: creator.id, platform, status: "available" } });
    imported++;
    const k = `${creator.name}/${platform}`;
    byBucket[k] = (byBucket[k] ?? 0) + 1;
  }
  return { imported, skipped, byBucket };
}

/**
 * Claim the next available trial link for an assignment, matching its model +
 * platform, and point the VA's promo redirect at it. Idempotent — a VA that
 * already has one keeps it. Alerts ops if the bucket is empty (VA falls back to
 * the model's shared link) or running low.
 */
export async function claimTrialLink(assignmentId: string): Promise<{ claimed: boolean; label?: string }> {
  const asg = await prisma.assignment.findUnique({ where: { id: assignmentId }, include: { role: true } });
  if (!asg || asg.trialLinkUrl) return { claimed: false }; // gone, or already has one
  const platform = ROLE_PLATFORM[asg.role.key];
  if (!platform) return { claimed: false };

  const link = await prisma.trialLink.findFirst({
    where: { creatorId: asg.creatorId, platform, status: "available" },
    orderBy: { createdAt: "asc" },
  });
  if (!link) {
    const creator = await prisma.creator.findUnique({ where: { id: asg.creatorId } });
    await sendOpsAlert(
      `⚠ Trial-link pool EMPTY for ${creator?.name ?? "model"}/${platform} — add more Infloww links and import them on /vas. This VA fell back to the shared model link for now.`
    );
    return { claimed: false };
  }

  // Claim it. The @unique on assignmentId + status guard means a concurrent
  // claim of the same row just no-ops the loser (they'll grab the next one).
  await prisma.trialLink.update({ where: { id: link.id }, data: { status: "assigned", assignmentId } });
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { trialLinkUrl: link.url, trialLinkLabel: link.label },
  });

  const left = await prisma.trialLink.count({
    where: { creatorId: asg.creatorId, platform, status: "available" },
  });
  if (left <= LOW_POOL_THRESHOLD) {
    const creator = await prisma.creator.findUnique({ where: { id: asg.creatorId } });
    await sendOpsAlert(
      `🔗 Trial-link pool low for ${creator?.name ?? "model"}/${platform} — ${left} left. Top up in Infloww + import on /vas.`
    );
  }
  return { claimed: true, label: link.label };
}

/** Per model+platform pool counts for the /vas dashboard. */
export async function trialLinkPoolStats() {
  const [links, creators] = await Promise.all([
    prisma.trialLink.findMany({ select: { creatorId: true, platform: true, status: true } }),
    prisma.creator.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(creators.map((c) => [c.id, c.name]));
  const buckets = new Map<string, { creatorName: string; platform: string; available: number; assigned: number }>();
  for (const l of links) {
    const key = `${l.creatorId}/${l.platform}`;
    const b = buckets.get(key) ?? { creatorName: nameById.get(l.creatorId) ?? "?", platform: l.platform, available: 0, assigned: 0 };
    if (l.status === "assigned") b.assigned++;
    else b.available++;
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => a.creatorName.localeCompare(b.creatorName) || a.platform.localeCompare(b.platform));
}
