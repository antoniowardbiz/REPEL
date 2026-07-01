import { AccountStatus, ACCOUNT_STATUS_META, Stage, STAGE_META, Tier } from "./constants";

// Server-safe relative time → short string (computed once, passed as prop to
// avoid client/server hydration mismatches).
export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  const abs = Math.abs(secs);
  const sign = secs < 0 ? "in " : "";
  const suffix = secs < 0 ? "" : " ago";
  const fmt = (n: number, u: string) => `${sign}${n}${u}${suffix}`;
  if (abs < 60) return "just now";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  return fmt(Math.round(abs / 86400), "d");
}

export function deadlineLabel(deadline: Date | string | null | undefined): {
  text: string;
  tone: "good" | "warn" | "bad";
} {
  if (!deadline) return { text: "no deadline", tone: "warn" };
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { text: "expired", tone: "bad" };
  const hrs = ms / 3600_000;
  const text = hrs >= 1 ? `${Math.round(hrs)}h left` : `${Math.round(ms / 60000)}m left`;
  return { text, tone: hrs <= 2 ? "bad" : hrs <= 12 ? "warn" : "good" };
}

export function stageBadgeClass(stage: Stage): string {
  const tone = STAGE_META[stage]?.tone ?? "neutral";
  switch (tone) {
    case "active":
      return "border-brand/40 text-brand2 bg-brand/10";
    case "review":
      return "border-warn/40 text-warn bg-warn/10";
    case "good":
      return "border-good/40 text-good bg-good/10";
    case "bad":
      return "border-bad/40 text-bad bg-bad/10";
    default:
      return "border-line text-muted bg-panel2";
  }
}

export function accountStatusBadgeClass(status: string): string {
  const tone = ACCOUNT_STATUS_META[status as AccountStatus]?.tone ?? "neutral";
  switch (tone) {
    case "active":
      return "border-brand/40 text-brand2 bg-brand/10";
    case "review":
      return "border-warn/40 text-warn bg-warn/10";
    case "good":
      return "border-good/40 text-good bg-good/10";
    case "bad":
      return "border-bad/40 text-bad bg-bad/10";
    default:
      return "border-line text-muted bg-panel2";
  }
}

export function tierBadgeClass(tier: Tier | null | undefined): string {
  switch (tier) {
    case "A":
      return "bg-good/15 text-good border border-good/40";
    case "B":
      return "bg-brand/15 text-brand2 border border-brand/40";
    case "C":
      return "bg-warn/15 text-warn border border-warn/40";
    case "REJECT":
      return "bg-bad/15 text-bad border border-bad/40";
    default:
      return "bg-panel2 text-muted border border-line";
  }
}
