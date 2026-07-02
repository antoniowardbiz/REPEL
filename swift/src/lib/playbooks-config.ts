// Short, public per-role SOPs ("playbooks") shown at /playbook/<roleKey>. Linked
// from the trial brief so applicants have one place to learn exactly how we
// operate. Keep them tight and scannable — this is a quick reference, not a book.

export type PlaybookSection = { h: string; body: string; bullets?: string[] };
export type Playbook = { title: string; intro: string; sections: PlaybookSection[] };

export const PLAYBOOKS: Record<string, Playbook> = {
  x_va: {
    title: "X (Twitter) VA — Playbook",
    intro:
      "You run a model's X presence like it's the job: grow her reach, keep the account active and natural, and turn attention into fans on her page. This is exactly what a strong trial (and a strong hire) looks like.",
    sections: [
      {
        h: "Your daily numbers",
        body: "Hit these every day — it's the rhythm of the role:",
        bullets: [
          "6 feed posts (teasy, SFW, strong captions)",
          "50–60 follows + 50–60 unfollows (relevant accounts, keep the ratio healthy)",
          "5 viral comments (replies under posts that blew up in the last ~20h)",
          "Likes + retweets through the day to stay active",
          "Horny/teasy text posts 1–3× a day",
          "DMs worked as they come in",
        ],
      },
      {
        h: "What to post",
        body:
          "Strong, teasy SFW photos with captions that stop the scroll. Vary them — never copy-paste the same line. Stay on-brand for the model's voice. Mix in a few text-only teasy posts and retweets so the feed feels alive.",
      },
      {
        h: "Replies are the growth engine",
        body:
          "Find posts that went viral in the last ~20 hours in the niche and drop a teasy, on-brand reply that earns profile clicks. This is where most of your growth comes from — pick big, fresh posts, not old or low-reach ones.",
      },
      {
        h: "DMs",
        body:
          "Warm and human. Compliment first, then a natural nudge toward her page/link — never paste a raw link or spam. One nudge, then move on.",
      },
      {
        h: "Stay safe (don't get the account banned)",
        body: "Bans kill the account and the income. Non-negotiables:",
        bullets: [
          "SFW only on the feed — no nudity or explicit content",
          "Natural pacing — don't blast posts/follows in bursts",
          "Vary captions and replies — repetition looks like a bot",
          "No link-dumping, no bought followers",
          "No password changes; stop + report anything risky (shadowban, warning)",
        ],
      },
      {
        h: "The trial → getting hired",
        body:
          "It's a paid 24-hour trial: use any X account, hit the targets above, and show us your skill. Send your first post link in Telegram with the word SUBMIT. Strong trials get hired fastest — hires get a model, a content drive, daily targets, and pay ($75 bi-weekly, rising after your first two weeks if performance is high).",
      },
    ],
  },
  reddit_va: {
    title: "Reddit VA — Playbook",
    intro:
      "You post a model's content to the right subreddits, safely and by each sub's rules, to drive traffic to her page. Your manager sets you up and tells you exactly what to post.",
    sections: [
      {
        h: "How it works",
        body:
          "After you pass the quiz you'll be asked if you have a Reddit account. Either way you go to your manager, who checks or sets up + warms an account so it never gets banned, then tells you what to post. Once you're posting, send your link in Telegram with the word SUBMIT.",
      },
      {
        h: "Posting",
        body: "Quality over quantity — get it right for each sub:",
        bullets: [
          "Post only to allowed NSFW subs, following each sub's rules exactly",
          "Space posts out — don't trip spam filters",
          "Strong, sub-appropriate titles (vary them)",
          "Complete any required verification properly",
        ],
      },
      {
        h: "Account health",
        body:
          "Karma, account age and verification matter. A brand-new account posting hard gets banned instantly — that's why we warm accounts first. Follow your manager's process.",
      },
      {
        h: "Pay",
        body: "$2/hr · 4 hrs/day · +10% commission on all spend from your subs. Top Reddit VAs make $500+/week.",
      },
    ],
  },
};
