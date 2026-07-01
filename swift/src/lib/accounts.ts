// Account inventory & access tiers (Phase 3). Tracks which social accounts
// exist (per model), their warm-status, and which VAs hold access — with a
// one-click offboard that revokes everything a VA holds.

import { prisma } from "./db";
import { ACCOUNT_PLATFORMS, ACCOUNT_STATUSES } from "./constants";

async function audit(action: string, entity: string, entityId: string, meta?: any) {
  await prisma.auditLog.create({
    data: { action, entity, entityId, meta: meta ? JSON.stringify(meta) : null },
  });
}

export async function createAccount(input: {
  platform: string;
  handle: string;
  label?: string | null;
  creatorId?: string | null;
  status?: string;
  notes?: string | null;
}) {
  const platform = (ACCOUNT_PLATFORMS as readonly string[]).includes(input.platform)
    ? input.platform
    : "other";
  const status =
    input.status && (ACCOUNT_STATUSES as readonly string[]).includes(input.status)
      ? input.status
      : "warming";
  const account = await prisma.account.create({
    data: {
      platform,
      handle: input.handle.trim(),
      label: input.label?.trim() || null,
      creatorId: input.creatorId || null,
      status,
      notes: input.notes?.trim() || null,
    },
  });
  await audit("account_created", "Account", account.id, { platform, handle: account.handle });
  return account;
}

export async function setAccountStatus(accountId: string, status: string) {
  if (!(ACCOUNT_STATUSES as readonly string[]).includes(status)) throw new Error("invalid status");
  const account = await prisma.account.update({ where: { id: accountId }, data: { status } });
  await audit("account_status", "Account", accountId, { status });
  return account;
}

/** Grant a VA access to an account (idempotent: reuse an existing active grant). */
export async function grantAccess(accountId: string, userId: string, note?: string | null) {
  const existing = await prisma.accessGrant.findFirst({
    where: { accountId, userId, status: "active" },
  });
  if (existing) return existing;
  const grant = await prisma.accessGrant.create({
    data: { accountId, userId, note: note?.trim() || null, status: "active" },
  });
  await audit("access_granted", "AccessGrant", grant.id, { accountId, userId });
  return grant;
}

export async function revokeGrant(grantId: string) {
  const grant = await prisma.accessGrant.update({
    where: { id: grantId },
    data: { status: "revoked", revokedAt: new Date() },
  });
  await audit("access_revoked", "AccessGrant", grant.id, {
    accountId: grant.accountId,
    userId: grant.userId,
  });
  return grant;
}

/** One-click offboard: revoke every active grant a VA holds. */
export async function offboardUser(userId: string) {
  const active = await prisma.accessGrant.findMany({ where: { userId, status: "active" } });
  if (active.length === 0) return { revoked: 0 };
  await prisma.accessGrant.updateMany({
    where: { userId, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  });
  await audit("user_offboarded", "User", userId, { revoked: active.length });
  return { revoked: active.length };
}

export type AccountView = {
  id: string;
  platform: string;
  handle: string;
  label: string | null;
  status: string;
  creatorId: string | null;
  creatorName: string | null;
  grants: { id: string; userId: string; userName: string; grantedAt: string }[];
};

/** All accounts with their model and current (active) grants, for the page. */
export async function accountsOverview(): Promise<AccountView[]> {
  const accounts = await prisma.account.findMany({
    include: {
      creator: true,
      grants: {
        where: { status: "active" },
        include: { user: true },
        orderBy: { grantedAt: "asc" },
      },
    },
    orderBy: [{ platform: "asc" }, { handle: "asc" }],
  });
  return accounts.map((a) => ({
    id: a.id,
    platform: a.platform,
    handle: a.handle,
    label: a.label,
    status: a.status,
    creatorId: a.creatorId,
    creatorName: a.creator?.name ?? null,
    grants: a.grants.map((g) => ({
      id: g.id,
      userId: g.userId,
      userName: g.user.name,
      grantedAt: g.grantedAt.toISOString(),
    })),
  }));
}
