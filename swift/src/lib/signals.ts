// VA signal detection: when a hired VA tells the bot something's wrong, catch it
// and raise a "needs attention" flag (so it's visible on the dashboard) + alert
// ops — instead of it getting a generic AI reply and being forgotten. Two kinds:
//   • content_low  — they've run out of content to post → reload the drive
//   • account_issue — their account looks banned/suspended → hand a replacement
// Keyword-based and deliberately tight, to avoid false alarms.

import { prisma } from "./db";
import { sendOpsAlert } from "./telegram";
import { firstNameOf } from "./templates";
import { ROLE_PLATFORM } from "./roles-config";

export type VaSignal = "content_low" | "account_issue";

// Account trouble is checked first (higher urgency). Patterns are kept specific
// so ordinary chatter doesn't trip them.
const ACCOUNT_RE =
  /\b(shadow ?banned?|shadow ?ban|got (?:banned|suspended)|been (?:banned|suspended)|account (?:is )?(?:banned|suspended|disabled|locked|restricted|removed|gone|down)|(?:banned|suspended|locked out) (?:from|on|again)|can'?t (?:log ?in|get in|access) (?:to )?(?:my |the )?account|locked out)\b/i;

const CONTENT_RE =
  /\b((?:ran |run(?:ning)? |i'?m |im |all )?out of|no more|need (?:more|new|some more)|running low on|low on|finished (?:all )?(?:my |the )?)\s*(content|posts?|material|pics|photos|videos|vids|clips|stuff to post)\b|\bnothing (?:left )?to post\b|\bcontent (?:has )?run out\b/i;

/** Classify a VA message. Returns the signal, or null if it's just normal chat. */
export function classifyVaSignal(text: string): VaSignal | null {
  const t = text.trim();
  if (ACCOUNT_RE.test(t)) return "account_issue";
  if (CONTENT_RE.test(t)) return "content_low";
  return null;
}

/**
 * Raise a flag for a VA's signal: resolve their model + platform, persist an
 * OpsFlag (deduped — one OPEN flag per kind per VA), alert ops, and hand back a
 * reassuring reply for the bot to send. Safe for non-hired candidates (still
 * flags, just without model/platform context).
 */
export async function raiseVaFlag(
  candidateId: string,
  kind: VaSignal,
  text: string
): Promise<{ reply: string }> {
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  const first = firstNameOf(candidate?.fullName ?? "there");

  const asg = await prisma.assignment.findFirst({
    where: { user: { candidateId }, status: { in: ["probation", "active"] } },
    orderBy: { createdAt: "desc" },
    include: { creator: true, role: { include: { manager: true } } },
  });
  const model = asg?.creator?.name ?? "your model";
  const platform = asg ? ROLE_PLATFORM[asg.role.key] : undefined;
  const platformLabel = platform === "x" ? "X" : platform === "reddit" ? "Reddit" : "";
  const mgr = asg?.role.manager;
  const mgrRef = mgr ? `${mgr.name}${mgr.telegramHandle ? ` (${mgr.telegramHandle})` : ""}` : "your manager";

  // Dedupe: if there's already an open flag of this kind for this VA, don't spam
  // a second alert — just reassure again.
  const existing = await prisma.opsFlag.findFirst({ where: { candidateId, kind, status: "open" } });
  if (!existing) {
    await prisma.opsFlag.create({
      data: {
        kind,
        candidateId,
        assignmentId: asg?.id ?? null,
        creatorId: asg?.creatorId ?? null,
        platform: platform ?? null,
        note: text.slice(0, 200),
        status: "open",
      },
    });
    if (kind === "content_low") {
      await sendOpsAlert(
        `📉 CONTENT LOW: ${candidate?.fullName ?? candidateId} (${model}${platformLabel ? `/${platformLabel}` : ""}) is out of content — reload the ${model} ${platformLabel} drive. ("${text.slice(0, 120)}")`
      );
    } else {
      await sendOpsAlert(
        `🚫 ACCOUNT ISSUE: ${candidate?.fullName ?? candidateId}'s ${platformLabel || ""} account may be down (banned/suspended?) — check it and hand a replacement from the pool. ("${text.slice(0, 120)}")`
      );
    }
  }

  const reply =
    kind === "content_low"
      ? `Good shout ${first} — I've flagged it so fresh ${model} content gets loaded 👍 Post your strongest bits that are left today, and I'll let you know when the drive's topped up.`
      : `Thanks for flagging that ${first} 🙏 I've alerted ${mgrRef} to check the account and sort you a fresh one — sit tight, we'll get you back up fast. Don't keep trying to force the old login in the meantime.`;
  return { reply };
}

/** Open flags for the dashboard, newest first, with the VA + model context. */
export async function openFlags() {
  const flags = await prisma.opsFlag.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "desc" },
    include: { candidate: { select: { fullName: true } } },
    take: 50,
  });
  const creatorIds = [...new Set(flags.map((f) => f.creatorId).filter(Boolean) as string[])];
  const creators = creatorIds.length
    ? await prisma.creator.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(creators.map((c) => [c.id, c.name]));
  return flags.map((f) => ({
    id: f.id,
    kind: f.kind,
    vaName: f.candidate.fullName,
    model: f.creatorId ? nameById.get(f.creatorId) ?? null : null,
    platform: f.platform,
    note: f.note,
    createdAt: f.createdAt,
  }));
}

/** Mark a flag handled. */
export async function resolveFlag(id: string) {
  return prisma.opsFlag.update({ where: { id }, data: { status: "resolved", resolvedAt: new Date() } });
}
