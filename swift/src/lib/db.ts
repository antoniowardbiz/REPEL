import { PrismaClient } from "@prisma/client";
import { sendTelegramMessage } from "./telegram";
import { ROLE_PLATFORM } from "./roles-config";

// Reuse a single (extended) client across hot-reloads in dev to avoid exhausting
// connections.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof makeClient>;
  prismaBase?: PrismaClient;
  sqlitePragmasSet?: boolean;
};

// ── Live conversation mirror ────────────────────────────────────────────────
// A copy of EVERY candidate message — what the bot sends AND what candidates
// reply — is forwarded to an ops group so you watch conversations live in
// Telegram. Routed by the VA's platform: X VAs' conversations go to
// MIRROR_X_CHAT_ID and Reddit VAs' to MIRROR_REDDIT_CHAT_ID (set each to its own
// group so you see each platform in real time, separated). Everyone else — and
// anyone whose platform channel isn't set — falls back to the shared
// MIRROR_TELEGRAM_CHAT_ID. Fire-and-forget: never blocks or breaks the write,
// and the mirror send itself isn't recorded, so it can't loop.
async function mirror(
  base: PrismaClient,
  m: { candidateId?: string | null; direction?: string; body?: string; channel?: string | null }
) {
  if (m.channel !== "telegram" || !m.candidateId) return;
  const cand = await base.candidate.findUnique({
    where: { id: m.candidateId },
    select: { fullName: true, telegramHandle: true, currentRole: { select: { key: true } } },
  });
  const platform = cand?.currentRole?.key ? ROLE_PLATFORM[cand.currentRole.key] : undefined;
  const chat =
    (platform === "x" && process.env.MIRROR_X_CHAT_ID) ||
    (platform === "reddit" && process.env.MIRROR_REDDIT_CHAT_ID) ||
    process.env.MIRROR_TELEGRAM_CHAT_ID;
  if (!chat) return;
  const who = `${cand?.fullName ?? "Candidate"}${cand?.telegramHandle ? ` (${cand.telegramHandle})` : ""}`;
  const head = m.direction === "inbound" ? `🟢 ${who}` : `🤖 SWIFT → ${who}`;
  await sendTelegramMessage(chat, `${head}\n${m.body ?? ""}`);
}

function makeClient() {
  const base =
    globalForPrisma.prismaBase ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prismaBase = base;
  return base.$extends({
    query: {
      message: {
        async create({ args, query }) {
          const created = await query(args);
          void mirror(base, created as any).catch(() => {});
          return created;
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite hardening for concurrency at volume. WAL lets readers and writers work
// at the same time, and a busy timeout makes a writer WAIT for the lock (up to
// 5s) instead of instantly throwing "database is locked" — the difference
// between a queued submission and a lost one under a mass-hire burst.
if (!globalForPrisma.sqlitePragmasSet && (process.env.DATABASE_URL ?? "").startsWith("file:")) {
  globalForPrisma.sqlitePragmasSet = true;
  void (async () => {
    try {
      // These PRAGMAs return a row (the applied value), so use queryRaw — not
      // executeRaw, which errors on SQLite when a statement returns results.
      await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
      await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
    } catch (e) {
      console.warn("sqlite pragma init failed (non-fatal):", e);
    }
  })();
}
