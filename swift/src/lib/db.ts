import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot-reloads in dev to avoid exhausting
// connections.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  sqlitePragmasSet?: boolean;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite hardening for concurrency at volume. WAL lets readers and writers work
// at the same time, and a busy timeout makes a writer WAIT for the lock (up to
// 5s) instead of instantly throwing "database is locked" — which, under the
// concurrent Telegram-webhook writes + in-process scheduler we get during a
// mass-hire burst, is the difference between a queued submission and a lost one.
// Best-effort, run once, only for a file: (SQLite) datasource.
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
