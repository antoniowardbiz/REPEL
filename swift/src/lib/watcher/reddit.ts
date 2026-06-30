// Reddit trial watcher — uses Reddit's public JSON endpoints (no OAuth, no cost).
// Reads a trial account's recent submissions to measure volume, spacing, and
// removal/ban-risk. Reddit requires a descriptive User-Agent; low volume stays
// well inside the unauthenticated rate limit.

import { WatchMetrics } from "../rating";
import { spacingScoreFromTimestamps } from "./activity";

const UA = "swift-va-pipeline/1.0 (trial monitor)";

type RedditPost = {
  created_utc: number;
  subreddit: string;
  removed_by_category: string | null;
  score: number;
  title: string;
};

export async function fetchRedditMetrics(
  handle: string,
  sinceMs: number,
  targetPosts: number,
  responsiveness = 0
): Promise<WatchMetrics | null> {
  const user = handle.replace(/^\/?u\//i, "").replace(/^@/, "").trim();
  if (!user) return null;
  const url = `https://www.reddit.com/user/${encodeURIComponent(user)}/submitted.json?limit=50&sort=new`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const children: { data: RedditPost }[] = json?.data?.children ?? [];
    const sinceSec = sinceMs / 1000;
    const inWindow = children.map((c) => c.data).filter((p) => p.created_utc >= sinceSec);

    const posts = inWindow.length;
    const removed = inWindow.filter((p) => p.removed_by_category).length;
    const timestamps = inWindow.map((p) => p.created_utc * 1000).sort((a, b) => a - b);
    const spacingScore = spacingScoreFromTimestamps(timestamps, sinceMs, Date.now());
    const safetyOk = removed <= 1; // a removal or two happens; many = rule-breaking/ban risk

    return { posts, targetPosts, spacingScore, responsiveness, removed, safetyOk };
  } catch {
    return null; // network/parse failure → caller falls back to activity metrics
  }
}
