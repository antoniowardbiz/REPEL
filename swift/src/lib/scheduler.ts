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
import { backfillPromoLinks, sendPersonalLinks, repairModelTrialLinks } from "./services";
import { runWinback } from "./winback";
import { autoClearScoring } from "./autoscore";

const g = globalThis as unknown as { __swiftSchedulerStarted?: boolean };

const MORNING_HOUR = Number(process.env.MORNING_HOUR ?? 8);
const DIGEST_HOUR = Number(process.env.DIGEST_HOUR ?? 21);
const COACH_HOUR = Number(process.env.COACH_HOUR ?? 20); // proactive VA coaching, once/day
const LINKS_HOUR = Number(process.env.LINKS_HOUR ?? 9); // ensure every VA has + has received their link, once/day
const WINBACK_HOUR = Number(process.env.WINBACK_HOUR ?? 10); // re-engage stalled/expired VAs, once/day
const IMPROVE_DAY = Number(process.env.IMPROVE_DAY ?? 1); // weekly self-improvement (0=Sun … 6=Sat, Mon default)
const IMPROVE_HOUR = Number(process.env.IMPROVE_HOUR ?? 9);
const TZ_OFFSET = Number(process.env.TZ_OFFSET ?? 0);

let lastMorningDay = "";
let lastDigestDay = "";
let lastCoachDay = "";
let lastLinksDay = "";
let lastWinbackDay = "";
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
  // Keep the scorer queue empty automatically (mass-hire makes it busywork).
  setInterval(() => safe("autoscore", autoClearScoring), 60 * 60_000);

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
        // Never waste a VA: re-engage anyone who stalled/expired without hiring.
        if (h === WINBACK_HOUR && lastWinbackDay !== day) {
          lastWinbackDay = day;
          await runWinback();
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
  // Repair each model's OF free-trial link from config FIRST (the deploy skips
  // the seed), so /go's fallback points at the free trial — not the paid page —
  // before anything else reads it.
  setTimeout(() => safe("trial-link-repair", () => repairModelTrialLinks()), 15_000);
  // And generate any missing promo links right after boot, so a fresh deploy
  // immediately gives every active VA their tracked link (no button to click).
  setTimeout(() => safe("linkbackfill", () => backfillPromoLinks()), 20_000);
  // Clear any scoring backlog right after boot, and re-engage stalled VAs once,
  // so the fixes take effect immediately on this deploy (not only next cycle).
  setTimeout(() => safe("autoscore-boot", autoClearScoring), 25_000);
  setTimeout(() => safe("winback-boot", runWinback), 40_000);
}
