// In-process scheduler — the system runs its own recurring jobs (like the Python
// bots' asyncio loops) so on Railway (a persistent server) NO external cron is
// needed. Started once from instrumentation.ts on server boot.
//
// Cadence (overridable via env): watcher refresh hourly, deadline checks every
// 15m, stale sweep every 6h, morning + daily-digest once/day at local hours.
// Local time uses TZ_OFFSET (hours from UTC). The /api/cron/* routes remain as
// manual triggers / a backup if you'd rather drive it externally.

import { runDueWatches } from "./watcher";
import { runDeadlineChecks } from "./deadlines";
import { runStaleSweep } from "./stale";
import { sendDailyDigest, sendMorningMessages } from "./daily";
import { runDailyCoaching } from "./coaching";
import { runSelfImprovement } from "./self-improve";
import { backfillPromoLinks, sendPersonalLinks } from "./services";

const g = globalThis as unknown as { __swiftSchedulerStarted?: boolean };

const MORNING_HOUR = Number(process.env.MORNING_HOUR ?? 8);
const DIGEST_HOUR = Number(process.env.DIGEST_HOUR ?? 21);
const COACH_HOUR = Number(process.env.COACH_HOUR ?? 20); // proactive VA coaching, once/day
const LINKS_HOUR = Number(process.env.LINKS_HOUR ?? 9); // ensure every VA has + has received their link, once/day
const IMPROVE_DAY = Number(process.env.IMPROVE_DAY ?? 1); // weekly self-improvement (0=Sun … 6=Sat, Mon default)
const IMPROVE_HOUR = Number(process.env.IMPROVE_HOUR ?? 9);
const TZ_OFFSET = Number(process.env.TZ_OFFSET ?? 0);

let lastMorningDay = "";
let lastDigestDay = "";
let lastCoachDay = "";
let lastLinksDay = "";
let lastImproveDay = "";

function local() {
  return new Date(Date.now() + TZ_OFFSET * 3600_000);
}
const localHour = () => local().getUTCHours();
const localDow = () => local().getUTCDay();
const todayKey = () => local().toISOString().slice(0, 10);

async function safe(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[scheduler] ${label} failed:`, e);
  }
}

export function startScheduler() {
  if (g.__swiftSchedulerStarted || process.env.DISABLE_SCHEDULER === "1") return;
  g.__swiftSchedulerStarted = true;
  console.log("[scheduler] started (in-process)");

  setInterval(() => safe("watch", runDueWatches), 60 * 60_000);
  setInterval(() => safe("deadlines", runDeadlineChecks), 15 * 60_000);
  setInterval(() => safe("stale", runStaleSweep), 6 * 60 * 60_000);

  // Once-a-day jobs: poll every 15m, fire at the local hour, dedupe per day.
  setInterval(
    () =>
      safe("daily", async () => {
        const h = localHour();
        const day = todayKey();
        if (h === MORNING_HOUR && lastMorningDay !== day) {
          lastMorningDay = day;
          await sendMorningMessages();
        }
        if (h === DIGEST_HOUR && lastDigestDay !== day) {
          lastDigestDay = day;
          await sendDailyDigest();
        }
        if (h === COACH_HOUR && lastCoachDay !== day) {
          lastCoachDay = day;
          await runDailyCoaching();
        }
        // Every VA has a tracked link generated, and any who've never been sent
        // theirs get it DM'd — no manual "Backfill"/"Send links" clicks needed.
        if (h === LINKS_HOUR && lastLinksDay !== day) {
          lastLinksDay = day;
          await backfillPromoLinks();
          await sendPersonalLinks({ onlyUnsent: true });
        }
        // Weekly self-improvement pass (fires once, on IMPROVE_DAY at IMPROVE_HOUR).
        if (localDow() === IMPROVE_DAY && h === IMPROVE_HOUR && lastImproveDay !== day) {
          lastImproveDay = day;
          await runSelfImprovement();
        }
      }),
    15 * 60_000
  );

  // One pass shortly after boot so expired/overdue trials are caught promptly.
  setTimeout(() => safe("boot", runDeadlineChecks), 30_000);
  // And generate any missing promo links right after boot, so a fresh deploy
  // immediately gives every active VA their tracked link (no button to click).
  setTimeout(() => safe("linkbackfill", () => backfillPromoLinks()), 20_000);
}
