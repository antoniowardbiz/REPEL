// "Folders" = organizational buckets in the dashboard (NOT Telegram groups /
// invite links). All actual contact with the VA — including training — happens
// via the bot in DMs. A folder just records which bucket a candidate is in:
// the role's Trial bucket while trialing, then their model's Qualified bucket
// once hired (e.g. "X VA – Lae"). Moving buckets is automatic on stage change.
//
// (Auto-sorting the real Telegram chat-folders on an account would require a
// Telethon userbot via MTProto; this Bot-API build models folders as buckets.)

import { prisma } from "./db";

/** Which folder bucket a candidate belongs in at a given pipeline stage. */
export function folderKindForStage(stage: string): "trial" | "qualified" | null {
  switch (stage) {
    case "TRAINING":
    case "TRIAL_READY":
    case "TRIAL_ACTIVE":
    case "SUBMITTED":
    case "SCORING":
      return "trial";
    case "ONBOARDING":
    case "ACTIVE":
      return "qualified";
    default:
      return null;
  }
}

/** Resolve the target folder for (role, kind[, model]). */
export async function resolveFolder(roleId: string, kind: "trial" | "qualified", creatorId?: string | null) {
  if (kind === "qualified" && creatorId) {
    const exact = await prisma.telegramGroup.findFirst({ where: { roleId, kind, creatorId, active: true } });
    if (exact) return exact;
  }
  return prisma.telegramGroup.findFirst({ where: { roleId, kind, active: true } });
}

/** Place a candidate into a folder bucket (silent — purely organizational). */
export async function assignToFolder(candidateId: string, folderId: string) {
  const folder = await prisma.telegramGroup.findUnique({ where: { id: folderId } });
  if (!folder) throw new Error("folder not found");

  const membership = await prisma.groupMembership.upsert({
    where: { groupId_candidateId: { groupId: folderId, candidateId } },
    update: { status: "joined", removedAt: null },
    create: { groupId: folderId, candidateId, status: "joined", joinedAt: new Date() },
  });
  await prisma.activityEvent.create({
    data: { candidateId, type: "folder_routed", payload: JSON.stringify({ folder: folder.label, kind: folder.kind }) },
  });
  return { membership, folder };
}

/**
 * Route a candidate into the correct folder for their stage. When they move to a
 * Qualified folder, any Trial-folder membership is marked removed (they moved
 * buckets). `creatorId` picks the right model bucket (e.g. X VA – Lae).
 */
export async function routeToFolderForStage(candidateId: string, roleId: string, stage: string, creatorId?: string | null) {
  const kind = folderKindForStage(stage);
  if (!kind) return { skipped: true as const };
  const folder = await resolveFolder(roleId, kind, creatorId);
  if (!folder) return { skipped: true as const, reason: `no ${kind} folder for role` };

  // Leaving the trial bucket when promoted to qualified.
  if (kind === "qualified") {
    await prisma.groupMembership.updateMany({
      where: { candidateId, status: "joined", group: { kind: "trial" } },
      data: { status: "removed", removedAt: new Date() },
    });
  }
  const res = await assignToFolder(candidateId, folder.id);
  return { skipped: false as const, folder: res.folder };
}

/** Folders with current membership, for the Folders screen. */
export async function folderOverview() {
  return prisma.telegramGroup.findMany({
    where: { active: true },
    include: {
      role: true,
      creator: true,
      memberships: {
        where: { status: { not: "removed" } },
        include: { candidate: true },
        orderBy: { invitedAt: "desc" },
      },
    },
    orderBy: [{ kind: "asc" }, { label: "asc" }],
  });
}
