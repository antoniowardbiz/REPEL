// Role capacity & steering (mass-hire).
//
// Every applicant still gets to PICK a role — but if their pick is already
// "full" (its active funnel has reached the role's target headcount), we steer
// them to the role that needs people most. "Most needed" favours the biggest
// gap to target and, as a tiebreak, the role that has had the fewest recent
// applicants (so "10 IG DM handlers, no recent Reddit VAs" pushes to Reddit).
//
// Nothing here rejects anyone — when every role is full we still return a role
// so the pipeline never blocks (we are mass-hiring; onboard everyone).

import { prisma } from "./db";

// Stages that no longer count against a role's headcount.
const INACTIVE_STAGES = ["ARCHIVED", "REJECTED"] as const;

const RECENT_WINDOW_DAYS = 14;

export type RoleAvailability = {
  roleId: string;
  key: string;
  displayName: string;
  capacity: number | null; // null = unlimited
  load: number; // applications currently heading toward / in this role
  recent: number; // applications to this role in the last RECENT_WINDOW_DAYS
  remaining: number | null; // capacity - load (null when unlimited)
  open: boolean; // still accepting picks on the apply form
  need: number; // steering score — higher = needs people more
};

/**
 * Per-role availability across all ACTIVE roles, ordered most-needed first.
 * `load` counts every application not archived/rejected (i.e. everyone in the
 * funnel or already hired for that role).
 */
export async function roleAvailability(): Promise<RoleAvailability[]> {
  const roles = await prisma.role.findMany({
    where: { active: true },
    orderBy: { displayName: "asc" },
  });

  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 3600_000);

  const rows = await Promise.all(
    roles.map(async (r) => {
      const [load, recent] = await Promise.all([
        prisma.application.count({
          where: { roleId: r.id, stage: { notIn: INACTIVE_STAGES as unknown as string[] } },
        }),
        prisma.application.count({
          where: {
            roleId: r.id,
            appliedAt: { gte: since },
            stage: { notIn: INACTIVE_STAGES as unknown as string[] },
          },
        }),
      ]);
      const capacity = r.capacity ?? null;
      const remaining = capacity == null ? null : Math.max(0, capacity - load);
      const open = capacity == null || load < capacity;
      // Need score: gap to target, with a small recency bonus so quiet roles
      // rank above equally-empty busy ones. An unlimited (blanked) role has no
      // target, so its gap is 0 — it stays eligible (open) but ranks BELOW any
      // capped role that still has real room, instead of always winning.
      const gap = capacity == null ? 0 : capacity - load;
      const need = (open ? Math.max(0, gap) : -1) + 1 / (recent + 1);
      return {
        roleId: r.id,
        key: r.key,
        displayName: r.displayName,
        capacity,
        load,
        recent,
        remaining,
        open,
        need,
      } satisfies RoleAvailability;
    })
  );

  return rows.sort((a, b) => b.need - a.need);
}

/** The single most-needed OPEN role, or null when there are no active roles. */
export async function mostNeededRole(): Promise<RoleAvailability | null> {
  const avail = await roleAvailability();
  if (avail.length === 0) return null;
  const open = avail.filter((r) => r.open);
  return (open[0] ?? avail[0]) ?? null;
}

/**
 * Resolve the role an applicant should actually land in.
 *  - No preference → most-needed open role (used only when we must assign one).
 *  - Preferred role is open → keep it (everyone picks).
 *  - Preferred role is full → steer to the most-needed open role.
 *  - Everything full → fall back to the preference (never block a hire).
 */
export async function resolveOpenRoleId(
  preferredRoleId: string | null
): Promise<{ roleId: string | null; steered: boolean; from: string | null; to: string | null }> {
  const avail = await roleAvailability();
  if (avail.length === 0) return { roleId: preferredRoleId, steered: false, from: null, to: null };

  const byId = new Map(avail.map((r) => [r.roleId, r]));
  const preferred = preferredRoleId ? byId.get(preferredRoleId) ?? null : null;

  // Preferred role exists and is still open → honour the pick.
  if (preferred && preferred.open) {
    return { roleId: preferred.roleId, steered: false, from: preferred.key, to: preferred.key };
  }

  // Everything full → never block a hire, and don't yank someone off a valid
  // pick: honour their preference if they made one, else fall back to the
  // least-overloaded active role. No steering happens in this case.
  const open = avail.filter((r) => r.open);
  if (open.length === 0) {
    const roleId = preferred?.roleId ?? avail[0]?.roleId ?? preferredRoleId;
    return { roleId, steered: false, from: preferred?.key ?? null, to: roleId ? byId.get(roleId)?.key ?? null : null };
  }

  // Otherwise steer to the most-needed open role.
  const target = open[0];
  const steered = !!preferredRoleId && target.roleId !== preferredRoleId;
  return { roleId: target.roleId, steered, from: preferred?.key ?? null, to: target.key };
}
