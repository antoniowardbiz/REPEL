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

// Real wins from t.me/swiftteamwins (amounts as received, quotes lightly tidied).
export const PAYOUT_WINS: PayoutWin[] = [
  {
    handle: "Rica",
    role: "Reddit VA",
    amount: "$3,176",
    period: "1 month",
    note: "“BEST DAY EVER 😭❤️ I can't believe I made this much in a month — going even harder every day”",
  },
  {
    handle: "Erwinn",
    role: "Reddit VA",
    amount: "$747.72",
    period: "monthly payout",
    note: "“This is great 👍”",
  },
  {
    handle: "Glenn",
    role: "X VA",
    amount: "$500",
    period: "payout",
    note: "“ANOTHER ONE 🤙”",
  },
  {
    handle: "Andres",
    role: "Reddit VA",
    amount: "$429.52",
    period: "payout",
    note: "“Posted 10x a day on every account — sent over 1,000 subs 💪”",
  },
  {
    handle: "Arnel",
    role: "X VA",
    amount: "$394.33",
    period: "1 week",
    note: "“Let's gooo 💪💪”",
  },
  {
    handle: "Mark",
    role: "X VA",
    amount: "$385.66",
    period: "weekly payout",
    note: "“Weekly payout landed — grateful for this opportunity, working even harder next week”",
  },
  {
    handle: "Juan",
    role: "Reddit VA",
    amount: "$100.04",
    period: "first week",
    note: "“🔥🔥 LFG I GOT IT”",
  },
];

/** Wins for one role first (used on the role's training page); falls back to all. */
export function winsForRole(roleName?: string | null): PayoutWin[] {
  if (!roleName) return PAYOUT_WINS;
  const key: PayoutWin["role"] | null = /reddit/i.test(roleName)
    ? "Reddit VA"
    : /x|twitter/i.test(roleName)
    ? "X VA"
    : null;
  if (!key) return PAYOUT_WINS;
  const mine = PAYOUT_WINS.filter((w) => w.role === key);
  return mine.length > 0 ? mine : PAYOUT_WINS;
}

// True aggregate stats (headline numbers above the win cards).
export const PAYOUT_STATS = [
  { value: "$3,176", label: "best month — Reddit VA" },
  { value: "$500+", label: "top VAs / week" },
  { value: "Weekly", label: "payouts, every week" },
];
