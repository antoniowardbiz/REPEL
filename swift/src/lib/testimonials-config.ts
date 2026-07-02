// Payout proof shown to applicants (apply page + trial training pages).
//
// WINS entries are REAL payouts pulled from the public wins channel — add them
// here as they happen (handle can be partially masked, e.g. "@jm***"). Keep the
// list short and current: the 6 most impressive recent wins beat 40 stale ones.
// An empty list is fine — the section then shows the stat tiles + live channel
// link only, so nothing fake is ever displayed.

export const WINS_CHANNEL_HANDLE = "@swiftteamwins";
export const WINS_CHANNEL_URL = "https://t.me/swiftteamwins";

export type PayoutWin = {
  handle: string; // e.g. "@jm***" — mask most of it for privacy
  role: "Reddit VA" | "X VA";
  amount: string; // e.g. "$540" — exactly as paid
  period: string; // e.g. "1 week" | "May payout"
  note?: string; // optional one-liner, e.g. "3rd week in a row over $500"
};

export const PAYOUT_WINS: PayoutWin[] = [
  // Populate from t.me/swiftteamwins — examples of the shape:
  // { handle: "@jm***", role: "Reddit VA", amount: "$540", period: "1 week", note: "3rd week straight over $500" },
  // { handle: "@ka***", role: "X VA", amount: "$310", period: "1 week" },
];

// True aggregate stats (safe to show even with no individual wins yet).
export const PAYOUT_STATS = [
  { value: "$500+", label: "top Reddit VAs / week" },
  { value: "$2/hr + 10%", label: "base pay + commission" },
  { value: "Weekly", label: "payouts, every week" },
];
