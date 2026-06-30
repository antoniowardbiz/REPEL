// Even VA distribution across models (e.g. 50 on Lola / 50 on Lae). Assignment
// picks the least-loaded active model so the spread stays balanced as VAs are
// added; optional per-model weights let you target a non-even ratio.

import { prisma } from "./db";

const ACTIVE = ["probation", "active"];

export type ModelLoad = {
  creatorId: string;
  name: string;
  count: number; // active assignments
  weight: number; // target share (default 1 each → even split)
  share: number; // count / total
};

/** Current load per active model. */
export async function modelLoads(weights?: Record<string, number>): Promise<ModelLoad[]> {
  const creators = await prisma.creator.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const counts = await prisma.assignment.groupBy({
    by: ["creatorId"],
    where: { status: { in: ACTIVE } },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.creatorId, c._count._all]));
  const total = creators.reduce((a, c) => a + (byId.get(c.id) ?? 0), 0) || 1;
  return creators.map((c) => ({
    creatorId: c.id,
    name: c.name,
    count: byId.get(c.id) ?? 0,
    weight: weights?.[c.id] ?? 1,
    share: (byId.get(c.id) ?? 0) / total,
  }));
}

/**
 * The model that should receive the next VA: the one whose load is furthest
 * below its target weight (weighted least-loaded). Even weights → fewest-count.
 */
export async function pickModelForRole(weights?: Record<string, number>): Promise<string | null> {
  const loads = await modelLoads(weights);
  if (loads.length === 0) return null;
  // Sort by "deficit" = count / weight (lower = more under-served), then name.
  loads.sort((a, b) => a.count / a.weight - b.count / b.weight || a.name.localeCompare(b.name));
  return loads[0].creatorId;
}

/** Assign a hired VA to a model+role, auto-balancing if no model is given. */
export async function assignVa(input: {
  userId: string;
  roleId: string;
  creatorId?: string | null;
  managerUserId?: string | null;
}) {
  const creatorId = input.creatorId ?? (await pickModelForRole());
  if (!creatorId) throw new Error("no active model to assign to");
  const assignment = await prisma.assignment.create({
    data: {
      userId: input.userId,
      roleId: input.roleId,
      creatorId,
      managerUserId: input.managerUserId ?? null,
      status: "probation",
    },
  });
  await prisma.auditLog.create({
    data: { action: "va_assigned", entity: "Assignment", entityId: assignment.id, meta: JSON.stringify({ creatorId }) },
  });
  return assignment;
}

/** Distribution snapshot for the dashboard, incl. how balanced it is. */
export async function balanceReport(weights?: Record<string, number>) {
  const loads = await modelLoads(weights);
  const total = loads.reduce((a, l) => a + l.count, 0);
  const counts = loads.map((l) => l.count);
  const spread = counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
  return { loads, total, spread, balanced: spread <= 1 };
}
